export async function run() {
  const selected = canvas.tokens.controlled;
  if (!selected.length) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  const confirmed = await Dialog.confirm({
    title: "Remove All Status Effects?",
    content: "<p>Remove temporary effects from selected tokens?</p>",
    yes: () => true,
    no: () => false,
    defaultYes: true
  });

  if (!confirmed) return;

  for (const tkn of selected) {
    const actor = tkn.actor;
    if (!actor) continue;

    const removeList = (actor.temporaryEffects ?? []).map(e => e.id).filter(Boolean);
    if (!removeList.length) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", removeList);
  }
}