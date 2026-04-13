export async function run() {
  const confirmed = await Dialog.confirm({
    title: "Rotate selected",
    content: "<p>Rotate selected tokens clockwise?</p>",
    yes: () => true,
    no: () => false,
    defaultYes: true
  });

  if (!confirmed) return;

  const tokens = canvas.tokens.controlled;
  if (tokens.length === 0) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  const allowed = [0, 90, 180, 270];
  let debugLines = [];

  for (let t of tokens) {
    let last = await t.document.getFlag("world", "evanFacing");

    if (last === undefined) {
      last = t.rotation % 360;
      if (last < 0) last += 360;

      last = allowed.reduce((prev, curr) =>
        Math.abs(curr - last) < Math.abs(prev - last) ? curr : prev
      );
    }

    let index = allowed.indexOf(last);
    let next = allowed[(index + 1) % allowed.length];

    await t.document.update({ rotation: next });
    await t.document.setFlag("world", "evanFacing", next);

    debugLines.push(`${t.name}: ${last}° → ${next}°`);
  }

  await ChatMessage.create({
    speaker: { alias: "GM" },
    content: `<strong>Rotation Debug:</strong><br>${debugLines.join("<br>")}`,
    whisper: ChatMessage.getWhisperRecipients("GM")
  });
}