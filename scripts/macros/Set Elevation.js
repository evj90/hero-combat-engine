export async function run() {
  const selected = canvas.tokens.controlled ?? [];
  if (selected.length === 0) {
    ui.notifications.warn("Select one or more tokens first.");
    return;
  }

  const elevations = selected.map(token => Number(token.elevation ?? 0));
  const sharedElevation = elevations.every(elevation => elevation === elevations[0])
    ? String(elevations[0])
    : "";

  const flyingEffect = (CONFIG.statusEffects ?? []).find(effect => effect.id === "flying");
  const flyingLabel = flyingEffect?.label ?? flyingEffect?.name ?? "Flying";

  const result = await new Promise(resolve => {
    new Dialog({
      title: "Set Token Elevation",
      content: `
        <form>
          <p>Enter elevation value:</p>
          <input id="elev-value" type="number" value="${sharedElevation}" style="width:100%; margin-bottom:10px;">

          <div style="display:flex; gap:6px; justify-content:space-between; margin-top:6px;">
            <button type="button" id="btn-minus1">&lt;</button>
            <button type="button" id="btn-plus1">&gt;</button>
            <button type="button" id="btn-minus5">&lt;&lt;</button>
            <button type="button" id="btn-plus5">&gt;&gt;</button>
          </div>
        </form>
      `,
      buttons: {
        apply: {
          label: "Apply Elevation",
          callback: html => {
            const rawValue = html.find("#elev-value").val();
            const elevation = Number(rawValue);
            if (!Number.isFinite(elevation)) {
              ui.notifications.warn("Enter a valid elevation value.");
              return resolve(null);
            }

            resolve({ elevation });
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "apply",
      render: html => {
        const input = html.find("#elev-value");

        html.find("#btn-minus1").on("click", () => {
          input.val((Number(input.val()) || 0) - 1);
        });

        html.find("#btn-plus1").on("click", () => {
          input.val((Number(input.val()) || 0) + 1);
        });

        html.find("#btn-minus5").on("click", () => {
          input.val((Number(input.val()) || 0) - 5);
        });

        html.find("#btn-plus5").on("click", () => {
          input.val((Number(input.val()) || 0) + 5);
        });
      }
    }).render(true);
  });

  if (!result) return;

  const shouldFly = result.elevation > 0;
  const effectData = flyingEffect ?? (CONFIG.statusEffects ?? []).find(effect => effect.id === "flying");

  await Promise.all(selected.map(async token => {
    await token.document.update({ elevation: result.elevation });

    if (effectData) {
      if (typeof token.actor?.toggleStatusEffect === "function") {
        const active = token.actor.statuses?.has?.("flying") ?? false;
        if (shouldFly !== active) {
          await token.actor.toggleStatusEffect("flying");
        }
      } else if (typeof token.toggleEffect === "function") {
        const active = token.actor?.effects?.some(effect => !effect.disabled && effect.statuses?.has?.("flying")) ?? false;
        if (shouldFly !== active) {
          await token.toggleEffect(effectData);
        }
      }
    }
  }));

  ui.notifications.info(`Elevation set to ${result.elevation} for ${selected.length} token(s)${shouldFly ? ` and ${flyingLabel} applied` : ` and ${flyingLabel} removed`}.`);
}