import { HeroControllerPanel } from "./controller-panel.js";
import { SPD_MAP } from "./spd-map.js";
import { getActingTokens, resetActingTurnOrder, migrateLegacyAdjustments } from "./segment-engine.js";
import { combatEngineSpeaker, heroLog } from "./utils.js";

export async function beginCombat(tokenIds = null) {
  if (!canvas?.scene) return;
  const selected = (tokenIds?.length ? tokenIds.map(id => canvas.tokens.get(id)).filter(Boolean) : canvas.tokens.controlled);
  heroLog("beginCombat called with", selected.length, "selected tokens");

  if (selected.length === 0) {
    heroLog("No tokens selected");
    ui.notifications.warn("Select at least one token to begin combat.");
    return;
  }

  // Guard against accidentally restarting an in-progress combat.
  const existingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder");
  if (existingOrder?.length) {
    const confirmed = await Dialog.confirm({
      title: "Restart Combat?",
      content: "<p>Combat is already in progress. Restart with the current token selection?</p>"
    });
    if (!confirmed) return;
  }

  const currentPhase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  const currentSegment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  heroLog("Starting HERO combat (independent of Foundry combat tracker)");
  game.heroCombat.postDebugMessage(`[DEBUG] beginCombat() - Phase ${currentPhase}, Segment ${currentSegment} - Starting HERO combat with ${selected.length} tokens`);

  const participants = selected.map(t => t.name);
  heroLog("Participants:", participants);
  
  // Build the HERO combat participant order from all selected tokens.
  // Selection matters only here for adding tokens to combat; after this point
  // the engine uses the stored `hero-combat.actingOrder` and not current selection.
  const tieBreakStat = game.settings.get("hero-combat-engine", "tieBreakStat");
  const actingOrder = selected.map(t => {
    const actor = t.actor;
    const dex = actor?.system?.characteristics?.dex?.value ?? 0;
    const tieBreakVal = actor?.system?.characteristics?.[tieBreakStat]?.value ?? 0;
    return { tokenId: t.id, dex, tieBreakVal, name: t.name };
  }).sort((a, b) => {
    const dexCompare = b.dex - a.dex;
    if (dexCompare !== 0) return dexCompare;
    const tieCompare = b.tieBreakVal - a.tieBreakVal;
    if (tieCompare !== 0) return tieCompare;
    return a.name.localeCompare(b.name);
  }).map(entry => entry.tokenId);

  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.actingOrder", actingOrder);
  await canvas.scene.update({
    "flags.hero-combat-engine.heroCurrentActingIndex": 0,
    "flags.hero-combat-engine.heroSegment": 1,
    "flags.hero-combat-engine.heroPhase": 1
  });
  // Clear any leftover state from a previous combat.
  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.heldTokens", []);
  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.abortedTokens", []);
  await canvas.scene.unsetFlag("hero-combat-engine", "hero-combat.segmentOverride");
  heroLog("Acting order set:", actingOrder);

  ChatMessage.create({
    speaker: combatEngineSpeaker(1, 1),
    content: `
      <strong>Entering segmented movement</strong><br>
      <strong>Participants:</strong><br>
      ${participants.map(p => `• ${p}`).join("<br>")}
    `
  });
  
  // Show controller panel on combat start.
  // Always reuse an existing instance if one exists — never close it.
  // This keeps the panel in place regardless of whether it was opened
  // manually before Begin was clicked.
  try {
    if (!game.heroCombat.heroControllerPanel) {
      game.heroCombat.heroControllerPanel = new HeroControllerPanel();
    }
    game.heroCombat.heroControllerPanel.render(true);
    heroLog("Controller panel opened");
  } catch (err) {
    console.error("[HERO] Failed to open controller panel:", err);
  }

  // Notify non-GM players to open the tracker
  if (game.settings.get("hero-combat-engine", "autoOpenTrackerPlayers")) {
    game.socket.emit("module.hero-combat-engine", { type: "open-tracker" });
  }

  const migrated = await migrateLegacyAdjustments(selected.map(t => t.id));
  if (migrated.migratedEntries > 0) {
    heroLog("Migrated legacy adjustments on combat start", migrated);
  }

  // Highlight and announce the first token to act in segment 1
  await resetActingTurnOrder();
}

export async function addSelectedTokens(tokenIds = null) {
  if (!canvas?.scene) return;
  const selected = (tokenIds?.length ? tokenIds.map(id => canvas.tokens.get(id)).filter(Boolean) : canvas.tokens.controlled);
  heroLog("addSelectedTokens called with", selected.length, "selected tokens");

  if (selected.length === 0) {
    heroLog("No tokens selected");
    ui.notifications.warn("Select at least one token to add to combat.");
    return;
  }

  // Check if HERO combat is active (by checking if heroSegment flag exists)
  const currentSegment = canvas.scene.getFlag("hero-combat-engine", "heroSegment");
  heroLog("Current HERO segment:", currentSegment);
  
  if (currentSegment === null || currentSegment === undefined) {
    heroLog("No HERO combat in progress, starting new one");
    await beginCombat(selected.map(token => token.id));
    return;
  }

  const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  const segment = currentSegment;
  heroLog("HERO combat in progress, tokens will participate from next segment");
  const names = selected.map(t => t.name);
  ChatMessage.create({
    speaker: combatEngineSpeaker(phase, segment),
    content: `<strong>Tokens added to combat:</strong><br>${names.map(n => `• ${n}`).join("<br>")}<br><br><em>They will act starting in the next segment.</em>`
  });

  // Update acting order
  let actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const newTokenIds = selected.filter(t => !actingOrder.includes(t.id)).map(t => t.id);
  const allTokenIds = [...actingOrder, ...newTokenIds];
  const allEntries = allTokenIds.map(id => {
    const t = canvas.tokens.get(id);
    if (!t || !t.actor) return null;
    const dex = t.actor.system?.characteristics?.dex?.value ?? 0;
    const end = t.actor.system?.characteristics?.end?.value ?? 0;
    return { tokenId: id, dex, end, name: t.name };
  }).filter(e => e).sort((a, b) => {
    const dexCompare = b.dex - a.dex;
    if (dexCompare !== 0) return dexCompare;
    const endCompare = b.end - a.end;
    if (endCompare !== 0) return endCompare;
    return a.name.localeCompare(b.name);
  });
  actingOrder = allEntries.map(e => e.tokenId);

  // Capture the currently-acting token before overwriting the flag so the
  // active turn is not interrupted when a new token is inserted before it.
  const currentActingTokensBefore = getActingTokens(currentSegment);
  const currentlyActingId = currentActingTokensBefore[
    canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0
  ]?.id ?? null;

  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.actingOrder", actingOrder);

  if (newTokenIds.length) {
    const migrated = await migrateLegacyAdjustments(newTokenIds);
    if (migrated.migratedEntries > 0) {
      heroLog("Migrated legacy adjustments for added tokens", migrated);
    }
  }

  const currentActingTokensAfter = getActingTokens(currentSegment);
  const preservedIndex = currentlyActingId
    ? Math.max(0, currentActingTokensAfter.findIndex(t => t.id === currentlyActingId))
    : 0;
  await canvas.scene.setFlag("hero-combat-engine", "heroCurrentActingIndex", preservedIndex);
  heroLog("Updated acting order:", actingOrder);
}

export async function refreshCombatOrder() {
  if (!canvas?.scene) return;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  if (!actingOrder.length) {
    ui.notifications.warn("No combat in progress.");
    return;
  }

  const tieBreakStat = game.settings.get("hero-combat-engine", "tieBreakStat");
  const sorted = actingOrder.map(tokenId => {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return null;
    const actor = token.actor;
    const dex = actor.system?.characteristics?.dex?.value ?? 0;
    const tieBreakVal = actor.system?.characteristics?.[tieBreakStat]?.value ?? 0;
    return { tokenId, dex, tieBreakVal, name: token.name };
  }).filter(Boolean).sort((a, b) => {
    const dexComp = b.dex - a.dex;
    if (dexComp !== 0) return dexComp;
    const tieComp = b.tieBreakVal - a.tieBreakVal;
    if (tieComp !== 0) return tieComp;
    return a.name.localeCompare(b.name);
  }).map(e => e.tokenId);

  // Preserve the currently-acting token's position after re-sort
  const currentIndex = canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const currentActingId = getActingTokens(segment)[currentIndex]?.id ?? null;

  await canvas.scene.setFlag("hero-combat-engine", "hero-combat.actingOrder", sorted);

  const newActingTokens = getActingTokens(segment);
  const newIndex = currentActingId
    ? Math.max(0, newActingTokens.findIndex(t => t.id === currentActingId))
    : 0;
  await canvas.scene.setFlag("hero-combat-engine", "heroCurrentActingIndex", newIndex);

  ui.notifications.info("Combat order refreshed.");
  heroLog("refreshCombatOrder complete:", sorted);
}
