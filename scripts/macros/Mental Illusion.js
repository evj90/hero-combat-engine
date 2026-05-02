// ======================================================
// HERO Mental Illusion Attack Macro
// - Select attacker token
// - Target one or more tokens
// - Choose power
// - Roll OMCV vs DMCV
// - Roll effect
// - Apply MD and EGO
// - Announce result
// ======================================================

export async function run() {
  const attacker = canvas.tokens.controlled[0];
  if (!attacker) {
    ui.notifications.warn("Select your attacker first.");
    return;
  }

  const targets = Array.from(game.user.targets);
  if (targets.length === 0) {
    ui.notifications.warn("Target at least one token.");
    return;
  }

  const actor = attacker.actor;
  if (!actor) {
    ui.notifications.warn("Attacker has no actor data.");
    return;
  }

  // Pull all Mental Illusion powers from the attacker.
  const powers = actor.items.filter(i =>
    i.type === "power"
    && (i.name.toLowerCase().includes("mental illusion") || i.system?.power?.mentalIllusion)
  );

  if (powers.length === 0) {
    ui.notifications.warn("No Mental Illusion powers found on this actor.");
    return;
  }

  const powerChoices = powers.reduce((obj, p) => {
    obj[p.id] = `${p.name} (${p.system.dc}d6)`;
    return obj;
  }, {});

  // Prompt user to choose the power.
  const powerId = await new Promise(resolve => {
    new Dialog({
      title: "Choose Mental Illusion Power",
      content: `<p>Select the Mental Illusion attack to use:</p>
        <select id="mi-power">${Object.entries(powerChoices).map(([id, label]) =>
          `<option value="${id}">${label}</option>`).join("")}</select>`,
      buttons: {
        ok: {
          label: "Use Power",
          callback: html => resolve(html.find("#mi-power").val())
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok"
    }).render(true);
  });

  if (!powerId) return;

  const power = actor.items.get(powerId);
  if (!power) {
    ui.notifications.warn("Selected power could not be found.");
    return;
  }

  const dice = Number(power.system?.dc ?? 0);
  if (!Number.isFinite(dice) || dice <= 0) {
    ui.notifications.warn("Selected power has an invalid DC value.");
    return;
  }

  // Roll OMCV attack.
  const omcv = Number(actor.system?.characteristics?.omcv?.value ?? 0);
  const rollToHit = await (new Roll("3d6")).evaluate({ async: true });
  const hitTotal = Number(rollToHit.total ?? 0);

  rollToHit.toMessage({
    speaker: ChatMessage.getSpeaker({ token: attacker }),
    flavor: `<strong>Mental Illusion Attack:</strong> ${power.name}<br>OMCV: ${omcv}`
  });

  // Process each target.
  for (const t of targets) {
    const targetActor = t.actor;
    if (!targetActor) continue;

    const dmcv = Number(targetActor.system?.characteristics?.dmcv?.value ?? 0);
    const margin = omcv - dmcv;
    const hit = hitTotal <= (11 + margin);

    if (!hit) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: attacker }),
        content: `<strong>${t.name}</strong> resisted the Mental Illusion (attack missed).`
      });
      continue;
    }

    const effectRoll = await (new Roll(`${dice}d6`)).evaluate({ async: true });
    const effect = Number(effectRoll.total ?? 0);

    const md = Number(targetActor.system?.defenses?.mentalDefense?.value ?? 0);
    const ego = Number(targetActor.system?.characteristics?.ego?.value ?? 0);

    const netEffect = effect - md;
    const illusionLevel = netEffect - ego;

    effectRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ token: attacker }),
      flavor: `<strong>Mental Illusion Effect vs ${t.name}</strong><br>
               Raw Effect: ${effect}<br>
               Mental Defense: ${md}<br>
               Net Effect: ${netEffect}<br>
               Target EGO: ${ego}`
    });

    let result = "";
    if (illusionLevel <= 0) {
      result = `<strong>${t.name}</strong> resists the illusion.`;
    } else if (illusionLevel <= 10) {
      result = `<strong>${t.name}</strong> experiences a minor illusion.`;
    } else if (illusionLevel <= 20) {
      result = `<strong>${t.name}</strong> experiences a convincing illusion.`;
    } else {
      result = `<strong>${t.name}</strong> is fully controlled by the illusion.`;
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: attacker }),
      content: result
    });
  }
}