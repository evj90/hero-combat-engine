import { combatEngineSpeaker, heroLog } from "./utils.js";
import { clearHighlights } from "./highlight.js";

function getMCVUpdateData(actor, delta) {
  if (!delta) return {};

  const chars = actor.system?.characteristics ?? {};
  const updates = {};

  if (chars.mcv?.value != null) {
    updates["system.characteristics.mcv.value"] = (chars.mcv.value ?? 0) + delta;
    return updates;
  }

  if (chars.dmcv?.value != null) updates["system.characteristics.dmcv.value"] = (chars.dmcv.value ?? 0) + delta;
  if (chars.omcv?.value != null) updates["system.characteristics.omcv.value"] = (chars.omcv.value ?? 0) + delta;
  if (Object.keys(updates).length) return updates;

  updates["system.characteristics.mcv.value"] = delta;
  return updates;
}

function normalizeCharacteristicKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function getCharacteristicUpdateData(actor, statKey, delta) {
  if (!delta) return {};
  if (statKey === "mcv") return getMCVUpdateData(actor, delta);

  const chars = actor.system?.characteristics ?? {};
  return {
    [`system.characteristics.${statKey}.value`]: (chars?.[statKey]?.value ?? 0) + delta
  };
}

function getCombatValueModsFromEntry(entry) {
  const statMods = {};

  if (entry?.statMods && typeof entry.statMods === "object") {
    for (const [key, value] of Object.entries(entry.statMods)) {
      const statKey = normalizeCharacteristicKey(key);
      const numeric = Number(value ?? 0);
      if (!statKey || !Number.isFinite(numeric) || numeric === 0) continue;
      statMods[statKey] = (statMods[statKey] ?? 0) + numeric;
    }
  }

  const legacyMap = {
    ocv: Number(entry?.ocvMod ?? 0),
    dcv: Number(entry?.dcvMod ?? 0),
    mcv: Number(entry?.mcvMod ?? 0)
  };
  for (const [statKey, numeric] of Object.entries(legacyMap)) {
    if (!Number.isFinite(numeric) || numeric === 0) continue;
    statMods[statKey] = (statMods[statKey] ?? 0) + numeric;
  }

  return statMods;
}

function normalizeAdjustmentCharKey(char) {
  return String(char ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function getRevertDeltaMapForAdjustments(adjustments = []) {
  const total = {};
  for (const adj of adjustments) {
    const statKey = normalizeAdjustmentCharKey(adj.charKey ?? adj.char);
    const applied = Number(adj.appliedDelta ?? 0);
    if (!statKey || !applied) continue;
    total[statKey] = (total[statKey] ?? 0) - applied;
  }
  return total;
}

function getRevertUpdatesForBonusFlags(actor, tokenDocument) {
  const updates = {};

  const cover = Number(tokenDocument?.getFlag("hero-combat-engine", "coverDCV") ?? 0);
  if (cover) {
    updates["system.characteristics.dcv.value"] = (actor.system?.characteristics?.dcv?.value ?? 0) - cover;
  }

  const ocvBonus = Number(tokenDocument?.getFlag("hero-combat-engine", "ocvBonus") ?? 0);
  if (ocvBonus) {
    updates["system.characteristics.ocv.value"] = (actor.system?.characteristics?.ocv?.value ?? 0) - ocvBonus;
  }

  const mcvBonus = Number(tokenDocument?.getFlag("hero-combat-engine", "mcvBonus") ?? 0);
  if (mcvBonus) {
    Object.assign(updates, getMCVUpdateData(actor, -mcvBonus));
  }

  return updates;
}

async function clearAllTemporaryCVMods() {
  for (const token of canvas.tokens.placeables) {
    const actor = token?.actor;
    const mods = token?.document?.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
    const adjustments = token?.document?.getFlag("hero-combat-engine", "adjustments") ?? [];
    const hasCover = token?.document?.getFlag("hero-combat-engine", "coverDCV") != null;
    const hasOcvBonus = token?.document?.getFlag("hero-combat-engine", "ocvBonus") != null;
    const hasMcvBonus = token?.document?.getFlag("hero-combat-engine", "mcvBonus") != null;
    if (!actor || (!mods.length && !adjustments.length && !hasCover && !hasOcvBonus && !hasMcvBonus)) continue;

    const total = {};
    for (const mod of mods) {
      const statMods = getCombatValueModsFromEntry(mod);
      for (const [statKey, delta] of Object.entries(statMods)) {
        total[statKey] = (total[statKey] ?? 0) + delta;
      }
    }

    const updates = {};
    for (const [statKey, delta] of Object.entries(total)) {
      Object.assign(updates, getCharacteristicUpdateData(actor, statKey, -delta));
    }
    for (const [statKey, delta] of Object.entries(getRevertDeltaMapForAdjustments(adjustments))) {
      Object.assign(updates, getCharacteristicUpdateData(actor, statKey, delta));
    }
    Object.assign(updates, getRevertUpdatesForBonusFlags(actor, token.document));

    if (Object.keys(updates).length) await actor.update(updates);
    if (mods.length) await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
    if (adjustments.length) await token.document.unsetFlag("hero-combat-engine", "adjustments");
    if (hasCover) await token.document.unsetFlag("hero-combat-engine", "coverDCV");
    if (hasOcvBonus) await token.document.unsetFlag("hero-combat-engine", "ocvBonus");
    if (hasMcvBonus) await token.document.unsetFlag("hero-combat-engine", "mcvBonus");
  }
}

export async function endCombat() {
  if (!canvas?.scene) return;
  heroLog("endCombat called");
  
  const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  game.heroCombat.postDebugMessage(`[DEBUG] endCombat() - Phase ${phase}, Segment ${segment} - Cleaning up HERO combat state`);

  await clearHighlights();
  await clearAllTemporaryCVMods();

  // Clear all combat state in a single server round-trip.
  heroLog("Clearing all hero-combat-engine scene flags");
  await canvas.scene.update({
    "flags.hero-combat-engine.-=heroSegment":                    null,
    "flags.hero-combat-engine.-=heroPhase":                      null,
    "flags.hero-combat-engine.-=heroCurrentActingIndex":         null,
    "flags.hero-combat-engine.hero-combat.-=actingOrder":        null,
    "flags.hero-combat-engine.hero-combat.-=heldTokens":         null,
    "flags.hero-combat-engine.hero-combat.-=abortedTokens":      null,
    "flags.hero-combat-engine.hero-combat.-=segmentOverride":    null,
  });

  ChatMessage.create({
    speaker: combatEngineSpeaker(phase, segment),
    content: `<strong>HERO Combat Ended.</strong>`
  });
  
  // Hide controller panel on combat end
  try {
    if (game.heroCombat.heroControllerPanel) {
      game.heroCombat.heroControllerPanel.close();
      game.heroCombat.heroControllerPanel = null;
      heroLog("Controller panel closed");
    }
  } catch (err) {
    console.error("[HERO] Failed to close controller panel:", err);
  }

  // Notify all clients to close the tracker
  if (game.settings.get("hero-combat-engine", "autoCloseTrackerOnEnd")) {
    game.socket.emit("module.hero-combat-engine", { type: "close-tracker" });
  }
}