export async function openAttackModifierDialog(tokenId) {
  const panel = game.heroCombat?.heroControllerPanel;
  if (!panel || typeof panel._openCvAdjustmentDialog !== "function") {
    ui.notifications.warn("Temporary Combat Value Modifiers panel is unavailable.");
    return;
  }

  await panel._openCvAdjustmentDialog(tokenId);
}
