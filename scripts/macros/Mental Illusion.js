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

const attacker = canvas.tokens.controlled[0];
if (!attacker) return ui.notifications.warn("Select your attacker first.");

const targets = Array.from(game.user.targets);
if (targets.length === 0) return ui.notifications.warn("Target at least one token.");

const actor = attacker.actor;

// Pull all Mental Illusion powers from the attacker
const powers = actor.items.filter(i => 
  i.type === "power" && 
  (i.name.toLowerCase().includes("mental illusion") || i.system?.power?.mentalIllusion)
);

if (powers.length === 0) return ui.notifications.warn("No Mental Illusion powers found on this actor.");

const powerChoices = powers.reduce((obj, p) => {
  obj[p.id] = `${p.name} (${p.system.dc}d6)`;
  return obj;
}, {});

// Prompt user to choose the power
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
      }
    },
    default: "ok"
  }).render(true);
});

const power = actor.items.get(powerId);
const dice = power.system.dc;

// Roll OMCV attack
const omcv = actor.system.characteristics.omcv.value;
const rollToHit = await new Roll("3d6").roll({async: true});
const hitTotal = rollToHit.total;

// Chat announce attack roll
rollToHit.toMessage({
  speaker: ChatMessage.getSpeaker({token: attacker}),
  flavor: `<strong>Mental Illusion Attack:</strong> ${power.name}<br>OMCV: ${omcv}`
});

// Process each target
for (let t of targets) {
  const targetActor = t.actor;
  const dmcv = targetActor.system.characteristics.dmcv.value;

  const margin = omcv - dmcv;
  const hit = hitTotal <= (11 + margin);

  if (!hit) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({token: attacker}),
      content: `<strong>${t.name}</strong> resisted the Mental Illusion (attack missed).`
    });
    continue;
  }

  // Roll effect
  const effectRoll = await new Roll(`${dice}d6`).roll({async: true});
  const effect = effectRoll.total;

  // Pull defenses
  const md = targetActor.system.defenses.mentalDefense.value ?? 0;
  const ego = targetActor.system.characteristics.ego.value;

  const netEffect = effect - md;
  const illusionLevel = netEffect - ego;

  // Announce effect roll
  effectRoll.toMessage({
    speaker: ChatMessage.getSpeaker({token: attacker}),
    flavor: `<strong>Mental Illusion Effect vs ${t.name}</strong><br>
             Raw Effect: ${effect}<br>
             Mental Defense: ${md}<br>
             Net Effect: ${netEffect}<br>
             Target EGO: ${ego}`
  });

  // Determine outcome
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

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({token: attacker}),
    content: result
  });
}