import { SPD_MAP } from "./spd-map.js";
import { highlightActing, highlightToken } from "./highlight.js";
import { heroLog } from "./utils.js";

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

function getPost12RecoveryRule(stun) {
  const t1 = game.settings.get("hero-combat-engine", "recoveryStunEveryPhase");
  const t2 = game.settings.get("hero-combat-engine", "recoveryStunPost12Only");
  const t3 = game.settings.get("hero-combat-engine", "recoveryStunOnceAMinute");
  if (stun >= t1) return "Every Phase and post-Segment 12";
  if (stun >= t2) return "Post-Segment 12 only";
  if (stun >= t3) return "Once a minute only";
  return "GM's option (a long time)";
}

function isIncapacitatedActor(actor) {
  if (!actor) return false;
  const stun = actor.system?.characteristics?.stun?.value ?? 0;
  const body = actor.system?.characteristics?.body?.value ?? 0;
  return body <= 0 || stun <= 0;
}

async function post12RecoveryDebug() {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const messages = [];
  for (let t of canvas.tokens.placeables) {
    if (!actingOrder.includes(t.id)) continue;
    const actor = t.actor;
    if (!actor) continue;

    const stun = actor.system?.characteristics?.stun?.value ?? 0;
    const body = actor.system?.characteristics?.body?.value ?? 0;
    const rule = getPost12RecoveryRule(stun);
    const bodyThreshold = game.settings.get("hero-combat-engine", "recoveryBodyThreshold");
    const stunGmThreshold = game.settings.get("hero-combat-engine", "recoveryStunOnceAMinute") - 1;

    if (body <= bodyThreshold) {
      messages.push(`${t.name} skipped recovery because BODY ${body} indicates dead or dying.`);
      continue;
    }
    if (stun <= stunGmThreshold) {
      messages.push(`${t.name} skipped recovery because STUN ${stun} is in GM's option / long time.`);
      continue;
    }

    // These tokens are eligible for post-12 recovery; no skip message is needed.
    heroLog(`${t.name} is eligible for post-Segment 12 recovery (${rule}).`);
  }

  if (messages.length > 0 && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>Post-Segment 12 Recovery Skipped:</strong><br>${messages.join("<br>")}`
    });
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>Flash Recovery:</strong><br>${clearMessages.join("<br>")}`
    });
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
    if (!t) continue;

    const adjustments = t.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    if (!adjustments.length) continue;

    const kept = [];
    for (const adj of adjustments) {
      const fadeInterval = adj.fadeInterval === "segment" ? "segment" : "phase";
      if (fadeInterval !== normalizedInterval) {
        kept.push(adj);
        continue;
      }

      const newPoints = Math.max(adj.points - adj.fadeRate, 0);
      const typeLabel = adj.type === "drain" ? "Drain" : "Aid";
      const fadeUnitLabel = fadeInterval === "segment" ? "Segment" : "Phase";
      if (newPoints <= 0) {
        messages.push(`<strong>${t.name}</strong>: ${typeLabel} ${adj.char} faded completely (${adj.points} pts → 0, ${adj.fadeRate}/${fadeUnitLabel}).`);
        // entry dropped — not pushed to kept
      } else {
        messages.push(`<strong>${t.name}</strong>: ${typeLabel} ${adj.char} — ${adj.points} → ${newPoints} pts remaining (${adj.fadeRate}/${fadeUnitLabel}).`);
        kept.push({ ...adj, points: newPoints });
      }
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>Adjustment Fade (${intervalLabel}):</strong><br>${messages.join("<br>")}`
    });
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
    const revert = { ocv: 0, dcv: 0, mcv: 0 };

    for (const mod of mods) {
      const remaining = Math.max(0, (mod.remainingSegments ?? 1) - 1);
      if (remaining <= 0) {
        revert.ocv += mod.ocvMod ?? 0;
        revert.dcv += mod.dcvMod ?? 0;
        revert.mcv += mod.mcvMod ?? 0;

        const parts = [];
        if (mod.ocvMod) parts.push(`OCV ${mod.ocvMod > 0 ? "+" : ""}${mod.ocvMod}`);
        if (mod.dcvMod) parts.push(`DCV ${mod.dcvMod > 0 ? "+" : ""}${mod.dcvMod}`);
        if (mod.mcvMod) parts.push(`MCV ${mod.mcvMod > 0 ? "+" : ""}${mod.mcvMod}`);
        messages.push(`<strong>${t.name}</strong>: temporary CV mod expired (${parts.join(", ")}).`);
      } else {
        kept.push({ ...mod, remainingSegments: remaining });
      }
    }

    if (revert.ocv || revert.dcv || revert.mcv) {
      const chars = actor.system?.characteristics ?? {};
      const updates = {};
      if (revert.ocv) updates["system.characteristics.ocv.value"] = (chars.ocv?.value ?? 0) - revert.ocv;
      if (revert.dcv) updates["system.characteristics.dcv.value"] = (chars.dcv?.value ?? 0) - revert.dcv;
      Object.assign(updates, getMCVUpdateData(actor, -revert.mcv));
      if (Object.keys(updates).length) await actor.update(updates);
    }

    if (kept.length) await t.document.setFlag("hero-combat-engine", "cvSegmentMods", kept);
    else await t.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
  }

  if (messages.length && game.settings.get("hero-combat-engine", "chatPost12Recovery")) {
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>CV Modifiers:</strong><br>${messages.join("<br>")}`
    });
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${tokenName}</strong> now acts.`
    });
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${tokenName}</strong> now acts.`
    });
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${tokenName} now acts.</strong>`
    });
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
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${tokenName}</strong> releases their Hold and now acts.`
    });
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
    if (remaining.length > 0) {
      const confirmed = await Dialog.confirm({
        title: "Skip Acting Tokens?",
        content: `<p>The following tokens haven't acted yet this segment:</p><ul>${remaining.map(n => `<li>${n}</li>`).join("")}</ul><p>Advance to the next segment anyway?</p>`
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
    await post12RecoveryDebug();
  }

  // Get all SPD values from SPD_MAP that act in this segment
  const actingSPDs = [];
  for (const [spd, segments] of Object.entries(SPD_MAP)) {
    if (segments.includes(segment)) {
      actingSPDs.push(parseInt(spd));
    }
  }

  // Use getActingTokens to ensure same DEX/END/name sorting as turn order
  const actingTokenObjects = getActingTokens(segment);
  const actingTokenNames = actingTokenObjects.map(t => t.name);

  const spdList = actingSPDs.sort((a, b) => a - b).join(", ");
  const tokenList = actingTokenNames.length
    ? `<ul>${actingTokenNames.map(name => `<li>${name}</li>`).join("")}</ul>`
    : "None";

  if (game.settings.get("hero-combat-engine", "chatSegmentSummary")) {
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong>${spdList ? `<br>SPD Acting: ${spdList}` : ""}<br><strong>Tokens Acting:</strong> ${tokenList}`
    });
  }

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
        await post12RecoveryDebug();
      }
      const nextActors = getActingTokens(segment);
      if (nextActors.length > 0) break;
      skippedSegments.push(`${phase}.${segment}`);
    }
    if (game.settings.get("hero-combat-engine", "chatSkipEmptySegment") && skippedSegments.length > 0) {
      ChatMessage.create({
        speaker: { alias: "Combat Engine" },
        content: `<em>Skipped empty segment${skippedSegments.length > 1 ? "s" : ""}: ${skippedSegments.join(", ")}. Now at Segment ${phase}.${segment}.</em>`
      });
    }
  }

  await resetActingTurnOrder();
}