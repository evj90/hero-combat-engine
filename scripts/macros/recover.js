export async function run() {
  const confirmed = await Dialog.confirm({
    title: "Recover selected",
    content: "<p>Apply Recovery to selected tokens?</p>",
    yes: () => true,
    no: () => false,
    defaultYes: true
  });

  if (!confirmed) return;

  const tokens = canvas.tokens.controlled;
  if (tokens.length === 0) {
    ui.notifications.warn("No tokens selected for Recovery.");
    return;
  }

  const results = [];
  for (const t of tokens) {
    const actor = t.actor;
    if (!actor) continue;

    const rec = Number(actor.system?.characteristics?.rec?.value ?? 0);
    const stun = actor.system?.characteristics?.stun;
    const end = actor.system?.characteristics?.end;
    if (!stun || !end) continue;

    const newStun = Math.min(Number(stun.value ?? 0) + rec, Number(stun.max ?? stun.value ?? 0));
    const newEnd = Math.min(Number(end.value ?? 0) + rec, Number(end.max ?? end.value ?? 0));

    await actor.update({
      "system.characteristics.stun.value": newStun,
      "system.characteristics.end.value": newEnd
    });

    results.push(`${actor.name} recovered REC ${rec}`);
  }

  if (!results.length) {
    ui.notifications.warn("No valid actors were updated.");
    return;
  }

  await ChatMessage.create({
    speaker: { alias: "GM" },
    content: `<strong>Recovery Applied:</strong><br>${results.join("<br>")}`
  });
  ui.notifications.info("Recovery applied to selected tokens.");
}