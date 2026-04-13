export async function run() {
  const tokens = canvas.tokens.controlled;
  if (tokens.length === 0) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  for (const t of tokens) {
    await t.document.update({ rotation: 0 });
  }
}