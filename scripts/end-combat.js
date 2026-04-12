import { heroLog } from "./utils.js";
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

async function clearAllTemporaryCVMods() {
  for (const token of canvas.tokens.placeables) {
    const actor = token?.actor;
    const mods = token?.document?.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
    if (!actor || !mods.length) continue;

    const total = mods.reduce((acc, m) => {
      acc.ocv += m.ocvMod ?? 0;
      acc.dcv += m.dcvMod ?? 0;
      acc.mcv += m.mcvMod ?? 0;
      return acc;
    }, { ocv: 0, dcv: 0, mcv: 0 });

    const chars = actor.system?.characteristics ?? {};
    const updates = {};
    if (total.ocv) updates["system.characteristics.ocv.value"] = (chars.ocv?.value ?? 0) - total.ocv;
    if (total.dcv) updates["system.characteristics.dcv.value"] = (chars.dcv?.value ?? 0) - total.dcv;
    Object.assign(updates, getMCVUpdateData(actor, -total.mcv));

    if (Object.keys(updates).length) await actor.update(updates);
    await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
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
    speaker: { alias: "Combat Engine" },
    content: `<strong>Segment ${phase}.${segment}</strong><br><strong>HERO Combat Ended.</strong>`
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