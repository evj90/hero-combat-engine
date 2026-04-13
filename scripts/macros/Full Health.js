export async function run() {
  const selected = canvas.tokens.controlled;
  if (!selected.length) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  await Dialog.confirm({
    title: "Full Health",
    content: `<p>You are about to heal ${selected.length} token(s). This performs the same operation as Full Health on each actor sheet and may remove temporary effects. Continue?</p>`,
    label: "Full Health",
    yes: () => {
      for (const token of selected) {
        token.actor?.FullHealth?.();
      }
    }
  });
}