function getCharacteristicValue(actor, key) {
  return Number(actor?.system?.characteristics?.[key]?.value ?? 0);
}

function getAttackOmcv(actor) {
  const omcv = getCharacteristicValue(actor, "omcv");
  if (omcv) return omcv;
  return getCharacteristicValue(actor, "mcv");
}

function getTargetMentalDefenseCv(actor) {
  const dmcv = getCharacteristicValue(actor, "dmcv");
  if (dmcv) return dmcv;
  return getCharacteristicValue(actor, "mcv");
}

function hasStatus(actor, statusId) {
  if (!actor || !statusId) return false;
  if (actor.statuses?.has?.(statusId)) return true;
  return (actor.effects ?? []).some(e => !e.disabled && [...(e.statuses ?? [])].includes(statusId));
}

async function applyStatusEffectOnToken(token, statusId) {
  const actor = token?.actor;
  if (!token || !actor || !statusId) return { ok: false, reason: "invalid" };
  if (hasStatus(actor, statusId)) return { ok: true, reason: "already-active" };

  const effectData = (CONFIG.statusEffects ?? []).find(e => e.id === statusId);
  if (!effectData) return { ok: false, reason: "unknown-status" };

  try {
    if (typeof actor.toggleStatusEffect === "function") {
      await actor.toggleStatusEffect(statusId);
    } else {
      await token.toggleEffect(effectData);
    }
    return { ok: true, reason: "applied" };
  } catch (err) {
    console.error("[HERO ERROR] Mental Illusion status apply failed:", err);
    return { ok: false, reason: "permission" };
  }
}

function getStatusLabel(statusId) {
  const effectData = (CONFIG.statusEffects ?? []).find(e => e.id === statusId);
  return effectData?.label ?? statusId;
}

function getAvailableMentalIllusionStatuses() {
  const wanted = [
    { id: "stun", label: "Stunned" },
    { id: "prone", label: "Prone" },
    { id: "blind", label: "Flashed (Sight)" },
    { id: "deaf", label: "Flashed (Hearing)" },
    { id: "restrain", label: "Entangled/Restrained" }
  ];

  const availableIds = new Set((CONFIG.statusEffects ?? []).map(e => e.id));
  return wanted.filter(s => availableIds.has(s.id));
}

export async function runMentalIllusionMacro() {
  const controlled = canvas.tokens.controlled ?? [];
  if (controlled.length !== 1) {
    ui.notifications.warn("Select exactly one attacker token before using Mental Illusion Attack.");
    return;
  }

  const attackerToken = controlled[0];
  const attacker = attackerToken.actor;
  if (!attacker) {
    ui.notifications.warn("The selected token has no actor.");
    return;
  }

  const targets = [...(game.user.targets ?? [])].filter(t => t?.actor);
  if (!targets.length) {
    ui.notifications.warn("Target one or more tokens before using Mental Illusion Attack.");
    return;
  }

  const attackerOmcv = getAttackOmcv(attacker);
  const statusOptions = getAvailableMentalIllusionStatuses();

  const config = await new Promise(resolve => {
    const statusMarkup = [
      '<option value="">No automatic status</option>',
      ...statusOptions.map(s => `<option value="${s.id}">${s.label}</option>`)
    ].join("");

    new Dialog({
      title: `Mental Illusion Attack - ${attacker.name}`,
      content: `
        <form>
          <div class="form-group">
            <label>Attack Modifier</label>
            <input type="number" id="mi-attack-mod" value="0"/>
          </div>
          <div class="form-group">
            <label>OMCV (from attacker)</label>
            <input type="number" id="mi-omcv" value="${attackerOmcv}"/>
          </div>
          <div class="form-group">
            <label>Effect Description</label>
            <input type="text" id="mi-effect-desc" placeholder="Describe the illusion effect"/>
          </div>
          <div class="form-group">
            <label>Status To Apply On Hit</label>
            <select id="mi-status-id">${statusMarkup}</select>
          </div>
        </form>
      `,
      buttons: {
        roll: {
          label: "Roll Attack",
          callback: html => resolve({
            attackMod: Number(html.find("#mi-attack-mod").val() ?? 0),
            omcv: Number(html.find("#mi-omcv").val() ?? attackerOmcv),
            effectDesc: String(html.find("#mi-effect-desc").val() ?? "").trim(),
            statusId: String(html.find("#mi-status-id").val() ?? "").trim()
          })
        },
        cancel: { label: "Cancel", callback: () => resolve(null) }
      },
      default: "roll"
    }).render(true);
  });

  if (!config) return;

  const resolvedOmcv = Number.isFinite(config.omcv) ? config.omcv : attackerOmcv;
  const attackMod = Number.isFinite(config.attackMod) ? config.attackMod : 0;
  const roll = await (new Roll("3d6")).evaluate({ async: true });

  const resultRows = [];
  const hitTargets = [];
  for (const targetToken of targets) {
    const targetActor = targetToken.actor;
    const targetDefense = getTargetMentalDefenseCv(targetActor);
    const targetNumber = 11 + resolvedOmcv + attackMod - targetDefense;
    const hit = roll.total <= targetNumber;
    const margin = Math.abs(targetNumber - roll.total);

    let applyNote = "";
    if (hit && config.statusId) {
      hitTargets.push({ tokenId: targetToken.id, targetName: targetToken.name });
      applyNote = " - pending GM effect";
    }

    resultRows.push(
      `<li><strong>${targetToken.name}</strong>: DEF ${targetDefense}, TN ${targetNumber} - ` +
      `${hit ? `HIT by ${margin}` : `MISS by ${margin}`}${applyNote}</li>`
    );
  }

  const hasPendingEffects = Boolean(config.statusId) && hitTargets.length > 0;
  const pendingEffects = hasPendingEffects
    ? {
      statusId: config.statusId,
      statusLabel: getStatusLabel(config.statusId),
      targets: hitTargets,
      applied: false
    }
    : null;

  const effectLine = config.effectDesc ? `<strong>Effect:</strong> ${config.effectDesc}<br>` : "";
  const gmActionLine = hasPendingEffects
    ? `<strong>Pending Effect:</strong> ${pendingEffects.statusLabel} on ${hitTargets.length} hit target${hitTargets.length === 1 ? "" : "s"}.<br><button type=\"button\" class=\"hero-mi-apply-effects\">Apply Hit Effects (GM)</button><br>`
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    roll,
    flags: {
      "hero-combat-engine": {
        mentalIllusion: pendingEffects
      }
    },
    content:
      `<strong>Mental Illusion Attack</strong><br>` +
      `<strong>Attacker:</strong> ${attacker.name}<br>` +
      `<strong>Roll:</strong> ${roll.total} on 3d6<br>` +
      `<strong>OMCV:</strong> ${resolvedOmcv} &nbsp; <strong>Mod:</strong> ${attackMod >= 0 ? "+" : ""}${attackMod}<br>` +
      effectLine +
      gmActionLine +
      `<strong>Targets:</strong><ul>${resultRows.join("")}</ul>`
  });
}

export function registerMentalIllusionChatHandlers() {
  Hooks.on("renderChatMessage", (message, html) => {
    const button = html[0]?.querySelector?.(".hero-mi-apply-effects");
    if (!button) return;

    const payload = message.getFlag("hero-combat-engine", "mentalIllusion");
    if (!payload || !payload.statusId || !Array.isArray(payload.targets) || !payload.targets.length) {
      button.disabled = true;
      button.textContent = "No Pending Effects";
      return;
    }

    if (payload.applied) {
      button.disabled = true;
      button.textContent = "Effects Applied";
      return;
    }

    if (!game.user.isGM) {
      button.disabled = true;
      button.title = "GM can apply these effects from chat.";
      return;
    }

    button.addEventListener("click", async ev => {
      ev.preventDefault();
      button.disabled = true;

      const statusId = payload.statusId;
      const statusLabel = payload.statusLabel ?? getStatusLabel(statusId);
      const results = [];

      for (const entry of payload.targets) {
        const token = canvas.tokens.get(entry.tokenId);
        if (!token?.actor) {
          results.push(`<li><strong>${entry.targetName}</strong>: token not found.</li>`);
          continue;
        }

        const outcome = await applyStatusEffectOnToken(token, statusId);
        if (outcome.ok && outcome.reason === "applied") {
          results.push(`<li><strong>${token.name}</strong>: ${statusLabel} applied.</li>`);
        } else if (outcome.ok && outcome.reason === "already-active") {
          results.push(`<li><strong>${token.name}</strong>: already had ${statusLabel}.</li>`);
        } else {
          results.push(`<li><strong>${token.name}</strong>: could not apply ${statusLabel}.</li>`);
        }
      }

      await message.setFlag("hero-combat-engine", "mentalIllusion.applied", true);
      button.textContent = "Effects Applied";

      await ChatMessage.create({
        speaker: { alias: "Combat Engine" },
        content: `<strong>Mental Illusion Effects (GM)</strong><br><ul>${results.join("")}</ul>`
      });
    });
  });
}
