import { SPD_MAP } from "./spd-map.js";
import { highlightActing, highlightToken } from "./highlight.js";
import { combatEngineSpeaker, heroLog } from "./utils.js";

async function postCombatChat(content, phase = null, segment = null) {
  return ChatMessage.create({
    speaker: combatEngineSpeaker(phase, segment),
    content
  });
}

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

function getAdjustmentBaseCharacteristicValue(actor, statKey) {
  if (statKey === "mcv") {
    const chars = actor.system?.characteristics ?? {};
    return Number(chars.mcv?.value ?? chars.dmcv?.value ?? chars.omcv?.value ?? 0);
  }
  return Number(actor.system?.characteristics?.[statKey]?.value ?? 0);
}

function getAdjustmentTargetDelta(baseValue, points, type) {
  const pct = Math.max(0, Number(points ?? 0));
  const magnitude = Math.round((Number(baseValue ?? 0) * pct) / 100);
  return type === "drain" ? -Math.abs(magnitude) : Math.abs(magnitude);
}

// One-time migration for legacy adjustment entries that predate metadata-backed
// Aid/Drain handling. Adds charKey/baseValue/appliedDelta and applies the
// corresponding stat delta so future fades are accurate.
export async function migrateLegacyAdjustments(tokenIds = []) {
  if (!canvas?.scene) return { migratedTokens: 0, migratedEntries: 0 };

  const ids = Array.isArray(tokenIds) && tokenIds.length
    ? tokenIds
    : (canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? []);

  let migratedTokens = 0;
  let migratedEntries = 0;

  for (const tokenId of ids) {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token?.document || !actor) continue;

    const adjustments = token.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    if (!adjustments.length) continue;

    const statDeltas = {};
    let touched = false;
    const migrated = adjustments.map(adj => {
      const hasAppliedMeta = Number.isFinite(Number(adj.appliedDelta));
      const hasBaseMeta = Number.isFinite(Number(adj.baseValue));
      const hasCharKey = Boolean(normalizeCharacteristicKey(adj.charKey));
      if (hasAppliedMeta && hasBaseMeta && hasCharKey) return adj;

      const statKey = normalizeCharacteristicKey(adj.charKey ?? adj.char);
      if (!statKey) return adj;

      const baseValue = getAdjustmentBaseCharacteristicValue(actor, statKey);
      const appliedDelta = getAdjustmentTargetDelta(baseValue, adj.points, adj.type);
      if (appliedDelta) {
        statDeltas[statKey] = (statDeltas[statKey] ?? 0) + appliedDelta;
      }

      touched = true;
      migratedEntries += 1;
      return {
        ...adj,
        charKey: statKey,
        baseValue,
        appliedDelta
      };
    });

    if (!touched) continue;

    const updates = {};
    for (const [statKey, delta] of Object.entries(statDeltas)) {
      Object.assign(updates, getCharacteristicUpdateData(actor, statKey, delta));
    }
    if (Object.keys(updates).length) {
      await actor.update(updates);
    }

    await token.document.setFlag("hero-combat-engine", "adjustments", migrated);
    migratedTokens += 1;
  }

  return { migratedTokens, migratedEntries };
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

function formatCombatValueModParts(statMods) {
  return Object.entries(statMods ?? {})
    .filter(([, value]) => Number(value ?? 0) !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([statKey, value]) => `${statKey.toUpperCase()} ${value > 0 ? "+" : ""}${value}`);
}

function isIncapacitatedActor(actor) {
  if (!actor) return false;
  const stun = actor.system?.characteristics?.stun?.value ?? 0;
  const body = actor.system?.characteristics?.body?.value ?? 0;
  return body <= 0 || stun <= 0;
}

async function post12RecoveryAllCombatants() {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const messages = [];

  for (const tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    if (!t?.actor) continue;

    const actor = t.actor;
    const chars = actor.system?.characteristics ?? {};
    const rec = Number(chars.rec?.value ?? 0);
    const stun = Number(chars.stun?.value ?? 0);
    const end = Number(chars.end?.value ?? 0);
    const stunMaxRaw = Number(chars.stun?.max ?? stun);
    const endMaxRaw = Number(chars.end?.max ?? end);
    const stunMax = Number.isFinite(stunMaxRaw) ? stunMaxRaw : stun;
    const endMax = Number.isFinite(endMaxRaw) ? endMaxRaw : end;

    if (!Number.isFinite(rec) || rec <= 0) {
      messages.push(`<strong>${t.name}</strong>: no REC available.`);
      continue;
    }

    const newStun = Math.min(stun + rec, stunMax);
    const newEnd = Math.min(end + rec, endMax);

    if (newStun !== stun || newEnd !== end) {
      await actor.update({
        "system.characteristics.stun.value": newStun,
        "system.characteristics.end.value": newEnd
      });
      messages.push(`<strong>${t.name}</strong>: STUN ${stun} -> ${newStun}, END ${end} -> ${newEnd}.`);
    } else {
      messages.push(`<strong>${t.name}</strong>: already at max recovery values.`);
    }
  }

  if (messages.length > 0 && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    await postCombatChat(`<strong>Post-Segment 12 Recovery (All Combatants):</strong><br>${messages.join("<br>")}`, phase, segment);
  }
}

// Per-segment Flash (sight and hearing) recovery.
// Recovers exactly 1 FP per segment for every combatant, regardless of whether
// the token acts this segment. Flash Defense is applied when the flash attack
// lands (reducing initial FP) but does not affect the recovery rate.
// When Flash Points reach 0 the corresponding status is removed automatically.
async function segmentFlashRecovery() {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const clearMessages = [];

  for (const tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    const actor = t?.actor;
    if (!actor) continue;

    // ── Sight Flash ──
    const fpSight = t.document.getFlag("hero-combat-engine", "flashPointsSight") ?? 0;
    if (fpSight > 0) {
      const newFp = fpSight - 1;
      if (newFp <= 0) {
        await t.document.unsetFlag("hero-combat-engine", "flashPointsSight");
        const effectData = CONFIG.statusEffects?.find(e => e.id === "blind");
        if (effectData) {
          const isBlind = actor.statuses?.has("blind") ?? actor.effects.some(e => [...(e.statuses ?? [])].includes("blind"));
          if (isBlind) {
            if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect("blind");
            else await t.toggleEffect(effectData);
          }
        }
        clearMessages.push(`<strong>${t.name}</strong> recovers from Flash (Sight) — sight restored.`);
      } else {
        await t.document.setFlag("hero-combat-engine", "flashPointsSight", newFp);
      }
    }

    // ── Hearing Flash ──
    const fpHearing = t.document.getFlag("hero-combat-engine", "flashPointsHearing") ?? 0;
    if (fpHearing > 0) {
      const newFp = fpHearing - 1;
      if (newFp <= 0) {
        await t.document.unsetFlag("hero-combat-engine", "flashPointsHearing");
        const effectData = CONFIG.statusEffects?.find(e => e.id === "deaf");
        if (effectData) {
          const isDeaf = actor.statuses?.has("deaf") ?? actor.effects.some(e => [...(e.statuses ?? [])].includes("deaf"));
          if (isDeaf) {
            if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect("deaf");
            else await t.toggleEffect(effectData);
          }
        }
        clearMessages.push(`<strong>${t.name}</strong> recovers from Flash (Hearing) — hearing restored.`);
      } else {
        await t.document.setFlag("hero-combat-engine", "flashPointsHearing", newFp);
      }
    }
  }

  // Only post a message when an effect fully clears — avoids segment-by-segment spam.
  if (clearMessages.length && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    await postCombatChat(`<strong>Flash Recovery:</strong><br>${clearMessages.join("<br>")}`, phase, segment);
  }
}

// Drain/Aid fade by interval.
// Reduces each tracked adjustment by its configured fade rate.
// Supports fade intervals of "segment" and "phase".
async function adjustmentFade(interval = "phase") {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const messages = [];
  const normalizedInterval = interval === "segment" ? "segment" : "phase";

  for (const tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    const actor = t?.actor;
    if (!t || !actor) continue;

    const adjustments = t.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    if (!adjustments.length) continue;

    const kept = [];
    const statDeltas = {};
    for (const adj of adjustments) {
      const fadeInterval = adj.fadeInterval === "segment" ? "segment" : "phase";
      if (fadeInterval !== normalizedInterval) {
        kept.push(adj);
        continue;
      }

      const statKey = normalizeCharacteristicKey(adj.charKey ?? adj.char);
      const newPoints = Math.max(adj.points - adj.fadeRate, 0);
      const hasAppliedMeta = Number.isFinite(Number(adj.appliedDelta));
      const hasBaseMeta = Number.isFinite(Number(adj.baseValue));
      let baseValue = Number(adj.baseValue ?? 0);
      let newApplied = Number(adj.appliedDelta ?? 0);
      if (hasAppliedMeta && hasBaseMeta) {
        const oldApplied = Number(adj.appliedDelta ?? 0);
        baseValue = Number(adj.baseValue ?? getAdjustmentBaseCharacteristicValue(actor, statKey));
        newApplied = getAdjustmentTargetDelta(baseValue, newPoints, adj.type);
        const delta = newApplied - oldApplied;
        if (delta !== 0) {
          statDeltas[statKey] = (statDeltas[statKey] ?? 0) + delta;
        }
      }

      const typeLabel = adj.type === "drain" ? "Drain" : "Aid";
      const fadeUnitLabel = fadeInterval === "segment" ? "Segment" : "Phase";
      if (newPoints <= 0) {
        messages.push(`<strong>${t.name}</strong>: ${typeLabel} ${adj.char} faded completely (${adj.points} pts → 0, ${adj.fadeRate}/${fadeUnitLabel}).`);
        // entry dropped — not pushed to kept
      } else {
        messages.push(`<strong>${t.name}</strong>: ${typeLabel} ${adj.char} — ${adj.points} → ${newPoints} pts remaining (${adj.fadeRate}/${fadeUnitLabel}).`);
        kept.push({ ...adj, points: newPoints, charKey: statKey, ...(hasAppliedMeta && hasBaseMeta ? { baseValue, appliedDelta: newApplied } : {}) });
      }
    }

    const updates = {};
    for (const [statKey, delta] of Object.entries(statDeltas)) {
      Object.assign(updates, getCharacteristicUpdateData(actor, statKey, delta));
    }
    if (Object.keys(updates).length) {
      await actor.update(updates);
    }

    if (kept.length) {
      await t.document.setFlag("hero-combat-engine", "adjustments", kept);
    } else {
      await t.document.unsetFlag("hero-combat-engine", "adjustments");
    }
  }

  if (messages.length && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const intervalLabel = normalizedInterval === "segment" ? "Per Segment" : "Per Phase";
    await postCombatChat(`<strong>Adjustment Fade (${intervalLabel}):</strong><br>${messages.join("<br>")}`, phase, segment);
  }
}

async function cvSegmentModifierTick() {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const messages = [];

  for (const tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    const actor = t?.actor;
    if (!t || !actor) continue;

    const mods = t.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
    if (!mods.length) continue;

    const kept = [];
    const revert = {};

    for (const mod of mods) {
      const remaining = Math.max(0, (mod.remainingSegments ?? 1) - 1);
      const modStats = getCombatValueModsFromEntry(mod);
      if (remaining <= 0) {
        for (const [statKey, delta] of Object.entries(modStats)) {
          revert[statKey] = (revert[statKey] ?? 0) + delta;
        }

        const parts = formatCombatValueModParts(modStats);
        messages.push(`<strong>${t.name}</strong>: temporary CV mod expired (${parts.join(", ")}).`);
      } else {
        kept.push({ ...mod, remainingSegments: remaining });
      }
    }

    if (Object.keys(revert).length) {
      const updates = {};
      for (const [statKey, delta] of Object.entries(revert)) {
        Object.assign(updates, getCharacteristicUpdateData(actor, statKey, -delta));
      }
      if (Object.keys(updates).length) await actor.update(updates);
    }

    if (kept.length) await t.document.setFlag("hero-combat-engine", "cvSegmentMods", kept);
    else await t.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
  }

  if (messages.length && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    await postCombatChat(`<strong>CV Modifiers:</strong><br>${messages.join("<br>")}`, phase, segment);
  }
}

export function getActingTokens(segment) {
  if (!canvas?.scene) return [];
  segment = segment ?? canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const skipIncapacitated = game.settings.get("hero-combat-engine", "autoSkipIncapacitated");

  // A per-segment override is written by releaseHold to splice a token into a
  // specific position without mutating the permanent DEX-sorted actingOrder.
  const segmentOverride = canvas.scene.getFlag("hero-combat-engine", "hero-combat.segmentOverride");
  if (segmentOverride?.length) {
    return segmentOverride.map(id => canvas.tokens.get(id)).filter(Boolean);
  }

  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const acting = [];

  for (let tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    if (!t) continue;
    const actor = t.actor;
    if (!actor) continue;
    if (skipIncapacitated && isIncapacitatedActor(actor)) continue;
    const spd = actor.system?.characteristics?.spd?.value ?? 0;
    if (!SPD_MAP[spd]?.includes(segment)) continue;
    acting.push(t);
  }
  return acting;
}

function getCurrentActingIndex() {
  return canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0;
}

async function setCurrentActingIndex(index) {
  await canvas.scene.setFlag("hero-combat-engine", "heroCurrentActingIndex", index);
  return index;
}

function emitTokenHighlight(tokenId) {
  if (!tokenId) return;
  // Only privileged users (GM, assistant, trusted) can create AmbientLight documents;
  // other clients see the glow automatically because AmbientLight is a scene document
  // that Foundry syncs to all clients.
  if (!game.user.isGM && game.user.role < (CONST.USER_ROLES?.TRUSTED ?? 2)) return;
  highlightToken(tokenId).catch(err => console.error("[HERO ERROR] highlightToken failed:", err));
}

export async function resetActingTurnOrder() {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  const actingTokens = getActingTokens(segment);
  if (!actingTokens.length) {
    await highlightActing();
    return;
  }
  const index = await setCurrentActingIndex(0);
  const tokenId = actingTokens[index]?.id;
  const tokenName = actingTokens[index]?.name;
  heroLog("resetActingTurnOrder index", index, "tokenId", tokenId, "tokenName", tokenName);
  emitTokenHighlight(tokenId);
  if (tokenName && game.settings.get("hero-combat-engine", "chatTokenTurns")) {
    await postCombatChat(`<strong>${tokenName}</strong> now acts.`, phase, segment);
  }
}

export async function previousSegment() {
  if (!canvas?.scene) return;
  let segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  let phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  segment--;
  if (segment < 1) {
    segment = 12;
    phase = Math.max(1, phase - 1);
  }
  heroLog("previousSegment moving to", segment, phase);
  await canvas.scene.update({ "flags.hero-combat-engine.heroSegment": segment, "flags.hero-combat-engine.heroPhase": phase });
  await resetActingTurnOrder();
}

export async function nextActingToken() {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const actingTokens = getActingTokens(segment);
  if (!actingTokens.length) {
    heroLog("nextActingToken no acting tokens, advancing segment");
    await segmentAdvance({ skipWarning: true });
    return;
  }
  const currentIndex = getCurrentActingIndex();
  const nextIndex = currentIndex + 1;
  if (nextIndex >= actingTokens.length) {
    heroLog("nextActingToken advancing to next segment from last actor");
    await segmentAdvance({ skipWarning: true });
    return;
  }
  await setCurrentActingIndex(nextIndex);
  const tokenId = actingTokens[nextIndex]?.id;
  const tokenName = actingTokens[nextIndex]?.name;
  heroLog("nextActingToken index", nextIndex, "tokenId", tokenId);

  const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  if (game.settings.get("hero-combat-engine", "chatTokenTurns")) {
    await postCombatChat(`<strong>${tokenName}</strong> now acts.`, phase, segment);
  }

  emitTokenHighlight(tokenId);
}

export async function previousActingToken() {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const actingTokens = getActingTokens(segment);
  if (!actingTokens.length) {
    heroLog("previousActingToken no acting tokens, moving to previous segment");
    await previousSegment();
    return;
  }
  const currentIndex = getCurrentActingIndex();
  if (currentIndex <= 0) {
    heroLog("previousActingToken moving to previous segment from first actor");
    await previousSegment();
    return;
  }
  const previousIndex = currentIndex - 1;
  await setCurrentActingIndex(previousIndex);
  const tokenId = actingTokens[previousIndex]?.id;
  const tokenName = actingTokens[previousIndex]?.name;
  heroLog("previousActingToken index", previousIndex, "tokenId", tokenId);

  const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  if (game.settings.get("hero-combat-engine", "chatTokenTurns")) {
    await postCombatChat(`<strong>${tokenName} now acts.</strong>`, phase, segment);
  }

  emitTokenHighlight(tokenId);
}

export async function endTokenSegment(tokenId) {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const actingTokens = getActingTokens(segment);
  if (!actingTokens.length) {
    heroLog("endTokenSegment no acting tokens");
    return;
  }

  const currentIndex = getCurrentActingIndex();
  const currentTokenId = actingTokens[currentIndex]?.id;
  if (currentTokenId !== tokenId) {
    heroLog("endTokenSegment token", tokenId, "is not acting, ignoring");
    return;
  }

  heroLog("endTokenSegment for token", tokenId, "at index", currentIndex);

  // Clear abort flag for the token that just acted
  const aborted = canvas.scene.getFlag("hero-combat-engine", "hero-combat.abortedTokens") ?? [];
  if (aborted.includes(tokenId)) {
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.abortedTokens", aborted.filter(id => id !== tokenId));
  }

  await nextActingToken();
}

/**
 * Declare a Hold for a token. The token's normal phase is skipped immediately
 * and they are placed in the held pool, available to release later this segment.
 */
export async function holdToken(tokenId) {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const actingTokens = getActingTokens(segment);
  const currentIndex = getCurrentActingIndex();
  const currentTokenId = actingTokens[currentIndex]?.id ?? null;

  // Add to held set
  const held = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
  if (!held.includes(tokenId)) {
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.heldTokens", [...held, tokenId]);
  }

  // If this token is active, advance the turn (skip past them)
  if (currentTokenId === tokenId) {
    await nextActingToken();
  }
}

/**
 * Release a held token, inserting them immediately after the current actor.
 * They become the next token to act.
 */
export async function releaseHold(tokenId) {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;

  // Remove from held set
  const held = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.heldTokens", held.filter(id => id !== tokenId));

  // Build the acting list for this segment, splice the released token in right after current index
  const actingTokens = getActingTokens(segment);
  const currentIndex = getCurrentActingIndex();

  // Remove the token from its natural position (if still in list) and insert at currentIndex+1
  const withoutToken = actingTokens.filter(t => t.id !== tokenId);
  const insertAt = Math.min(currentIndex + 1, withoutToken.length);
  withoutToken.splice(insertAt, 0, canvas.tokens.get(tokenId));

  // Write a per-segment acting override so only this segment's order is affected.
  // The permanent DEX-sorted actingOrder is not touched.
  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.segmentOverride", withoutToken.map(t => t.id));

  // Set index to point at the released token (insertAt)
  await setCurrentActingIndex(insertAt);

  const token = canvas.tokens.get(tokenId);
  const tokenName = token?.name ?? "Unknown";
  if (game.settings.get("hero-combat-engine", "chatTokenTurns")) {
    await postCombatChat(`<strong>${tokenName}</strong> releases their Hold and now acts.`, phase, segment);
  }
  emitTokenHighlight(tokenId);
}

export async function segmentAdvance({ skipWarning = false } = {}) {
  if (!canvas?.scene) return;
  let segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  let phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;

  heroLog("segmentAdvance called", { currentSegment: segment, currentPhase: phase });
  game.heroCombat.postDebugMessage(`[DEBUG] segmentAdvance() initiated - Phase ${phase}, Segment ${segment}`);

  if (!skipWarning && game.settings.get("hero-combat-engine", "warnSkipActing")) {
    const actingTokens = getActingTokens(segment);
    const currentIndex = getCurrentActingIndex();
    const remaining = actingTokens.slice(currentIndex).map(t => t.name);
    const heldTokenIds = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
    const heldNames = heldTokenIds
      .map(id => canvas.tokens.get(id)?.name)
      .filter(Boolean);

    if (remaining.length > 0 || heldNames.length > 0) {
      const remainingHtml = remaining.length
        ? `<p>The following tokens haven't acted yet this segment:</p><ul>${remaining.map(n => `<li>${n}</li>`).join("")}</ul>`
        : "";
      const heldHtml = heldNames.length
        ? `<p><strong>Held tokens will lose their Hold if you advance now:</strong></p><ul>${heldNames.map(n => `<li>${n}</li>`).join("")}</ul>`
        : "";
      const confirmed = await Dialog.confirm({
        title: "Skip Acting Tokens?",
        content: `${remainingHtml}${heldHtml}<p>Advance to the next segment anyway?</p>`
      });
      if (!confirmed) return;
    }
  }

  segment++;
  const wrapped = segment > 12;
  if (wrapped) {
    heroLog("Phase wrap - segment 13 reached, wrapping to 1 and incrementing phase");
    segment = 1;
    phase++;
  }

  heroLog("Setting flags", { newSegment: segment, newPhase: phase });
  await canvas.scene.update({ "flags.hero-combat-engine.heroSegment": segment, "flags.hero-combat-engine.heroPhase": phase });

  // Clear held tokens at segment boundary — held phase is lost
  const held = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
  if (held.length) {
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.heldTokens", []);
  }

  // Clear aborted tokens at segment boundary — abort declarations carry no further.
  const aborted = canvas.scene.getFlag("hero-combat-engine", "hero-combat.abortedTokens") ?? [];
  if (aborted.length) {
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.abortedTokens", []);
  }

  // Clear any per-segment acting order set by releaseHold.
  const segmentOverride = canvas.scene.getFlag("hero-combat-engine", "hero-combat.segmentOverride");
  if (segmentOverride) {
    await canvas.scene.unsetFlag("hero-combat-engine", "hero-combat.segmentOverride");
  }

  await segmentFlashRecovery();
  await cvSegmentModifierTick();
  await adjustmentFade("segment");
  if (wrapped) {
    await adjustmentFade("phase");
    await post12RecoveryAllCombatants();
  }

  // Use getActingTokens to ensure same DEX/END/name sorting as turn order.
  // Delay the segment summary until after any empty-segment auto-skip so chat
  // reflects the segment the tracker actually lands on.
  let actingTokenObjects = getActingTokens(segment);

  // Auto-skip: if this segment has no acting tokens and the setting is on,
  // silently advance again. Cap at 12 iterations to avoid an infinite loop
  // (e.g. if no tokens are in combat at all).
  if (game.settings.get("hero-combat-engine", "autoSkipEmptySegments") && actingTokenObjects.length === 0) {
    const skippedSegments = [`${phase}.${segment}`];
    let safetyBreak = 11;
    while (safetyBreak-- > 0) {
      segment++;
      let innerWrapped = false;
      if (segment > 12) {
        segment = 1;
        phase++;
        innerWrapped = true;
      }
      await canvas.scene.update({ "flags.hero-combat-engine.heroSegment": segment, "flags.hero-combat-engine.heroPhase": phase });
      await segmentFlashRecovery();
      await cvSegmentModifierTick();
      await adjustmentFade("segment");
      if (innerWrapped) {
        await adjustmentFade("phase");
        await post12RecoveryAllCombatants();
      }
      const nextActors = getActingTokens(segment);
      if (nextActors.length > 0) {
        actingTokenObjects = nextActors;
        break;
      }
      skippedSegments.push(`${phase}.${segment}`);
    }
    if (game.settings.get("hero-combat-engine", "chatSkipEmptySegment") && skippedSegments.length > 0) {
      await postCombatChat(`<em>Skipped empty segment${skippedSegments.length > 1 ? "s" : ""}: ${skippedSegments.join(", ")}.</em>`, phase, segment);
    }
  }

  const actingSPDs = [];
  for (const [spd, segments] of Object.entries(SPD_MAP)) {
    if (segments.includes(segment)) {
      actingSPDs.push(parseInt(spd));
    }
  }

  const actingTokenNames = actingTokenObjects.map(t => t.name);
  const spdList = actingSPDs.sort((a, b) => a - b).join(", ");
  const tokenList = actingTokenNames.length
    ? `<ul>${actingTokenNames.map(name => `<li>${name}</li>`).join("")}</ul>`
    : "None";

  if (game.settings.get("hero-combat-engine", "chatSegmentSummary")) {
    await postCombatChat(`${spdList ? `<strong>SPD Acting:</strong> ${spdList}<br>` : ""}<strong>Tokens Acting:</strong> ${tokenList}`, phase, segment);
  }

  await resetActingTurnOrder();
}