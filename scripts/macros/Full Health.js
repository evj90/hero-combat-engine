export async function run() {
  const selected = canvas.tokens.controlled;
  if (!selected.length) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  const names = selected.map(t => t.name).join(", ");

  await Dialog.confirm({
    title: "Full Health",
    content: `<p><strong>Tokens:</strong> ${names}</p><p>Fully heal <strong>${names}</strong>? This performs the same operation as Full Health on each actor sheet and may remove temporary effects.</p>`,
    label: "Full Health",
    yes: () => {
      for (const token of selected) {
        token.actor?.FullHealth?.();
      }
    }
  });
}