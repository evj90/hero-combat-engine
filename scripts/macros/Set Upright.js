export async function run() {
  const tokens = canvas.tokens.controlled;
  if (tokens.length === 0) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  const names = tokens.map(t => t.name).join(", ");

  const confirmed = await Dialog.confirm({
    title: "Set Upright",
    content: `<p><strong>Tokens:</strong> ${names}</p><p>Reset rotation to upright for selected tokens?</p>`,
    yes: () => true,
    no: () => false,
    defaultYes: true
  });

  if (!confirmed) return;

  for (const t of tokens) {
    await t.document.update({ rotation: 0 });
  }
}