// ===============================
// INLINE TEMPLATE
// ===============================
const INLINE_TEMPLATE = `
<h2>STR Contest</h2>

<div>{{{bar}}}</div>

<p style="text-align:center; margin-top:4px;">
  <strong>{{grappler.name}}:</strong> {{gSTR}} STR  
  &nbsp;|&nbsp;
  <strong>{{target.name}}:</strong> {{tSTR}} STR
</p>

{{#if lastG}}
<p><strong>{{grappler.name}} Roll:</strong> {{lastG}}</p>
{{/if}}

{{#if lastT}}
<p><strong>{{target.name}} Roll:</strong> {{lastT}}</p>
{{/if}}

<hr>

<div style="display:flex; flex-direction:column; gap:6px;">
  <button id="gRoll">Roll {{grappler.name}} STR</button>
  <button id="tRoll">Roll {{target.name}} STR</button>

  <hr>

  <button id="squeeze">Squeeze (Damage)</button>
  <button id="throw">Throw Target</button>
  <button id="pin">Pin / Immobilize</button>
  <button id="drag">Drag / Move Target</button>

  <hr>

  <button id="breakFree">Target Attempts Break Free</button>
  <button id="release">Release Target</button>
</div>
`;

// ===============================
// APPLICATION CLASS
// ===============================
class GrappleTracker extends Application {
  constructor(grappler, target, gSTR, tSTR) {
    super();
    this.grappler = grappler;
    this.target = target;
    this.gSTR = gSTR;
    this.tSTR = tSTR;

    this.lastG = null;   // last grappler roll
    this.lastT = null;   // last target roll
  }

  static get defaultOptions() {
    const base = super.defaultOptions;
    const merged = (foundry?.utils?.mergeObject ?? mergeObject)(base, {
      id: "grapple-tracker",
      title: "Grapple STR Contest",
      popOut: true,
      resizable: true,
      width: 420,
      height: "auto"
    });
    return merged;
  }

  // Render using inline Handlebars template instead of a file
  async _renderInner(data, options) {
    const templateFn = Handlebars.compile(INLINE_TEMPLATE);
    const html = templateFn(data);
    return $(html);
  }

  getData() {
    return {
      grappler: this.grappler,
      target: this.target,
      gSTR: this.gSTR,
      tSTR: this.tSTR,
      lastG: this.lastG,
      lastT: this.lastT,
      bar: this.buildBar()
    };
  }

buildBar() {
  const gVal = this.lastG ?? this.gSTR;
  const tVal = this.lastT ?? this.tSTR;

  const total = gVal + tVal || 1;
  const gPct = Math.round((gVal / total) * 100);
  const tPct = 100 - gPct;

  const gColor = gVal > tVal ? "#4CAF50" : gVal < tVal ? "#B71C1C" : "#FBC02D";
  const tColor = tVal > gVal ? "#4CAF50" : tVal < gVal ? "#B71C1C" : "#FBC02D";

  return `
    <div style="display:flex; width:100%; height:28px; border:1px solid #333; font-size:12px; font-weight:bold; color:white;">
      <div style="
        width:${gPct}%;
        background:${gColor};
        display:flex;
        align-items:center;
        justify-content:center;
        overflow:hidden;
        white-space:nowrap;
      ">
        ${this.grappler.name}: ${gVal}
      </div>

      <div style="
        width:${tPct}%;
        background:${tColor};
        display:flex;
        align-items:center;
        justify-content:center;
        overflow:hidden;
        white-space:nowrap;
      ">
        ${this.target.name}: ${tVal}
      </div>
    </div>
  `;
}

  activateListeners(html) {
    super.activateListeners(html);
    html.find("#gRoll").on("click", () => this.rollG());
    html.find("#tRoll").on("click", () => this.rollT());
    html.find("#breakFree").on("click", () => this.breakFree());
    html.find("#release").on("click", () => this.release());
    html.find("#squeeze").on("click", () => this.squeeze());
    html.find("#throw").on("click", () => this.throwTarget());
    html.find("#pin").on("click", () => this.pinTarget());
    html.find("#drag").on("click", () => this.dragTarget());
  }

async _roll3d6(token, str, flavor) {
  const roll = new Roll("3d6");
  await roll.evaluate({async: true});
  await roll.toMessage({flavor, speaker: null});

  // END cost for STR effort
  const endCost = Math.ceil(str / 5);
  ui.notifications.info(`${token.name} spends ${endCost} END for STR effort.`);

  return roll;
}

async rollG() {
  const roll = await this._roll3d6(
    this.grappler,
    this.gSTR,
    `${this.grappler.name} STR Roll`
  );

  this.lastG = roll.total;
  this.render(false);
}

async rollT() {
  const roll = await this._roll3d6(
    this.target,
    this.tSTR,
    `${this.target.name} STR Roll`
  );

  this.lastT = roll.total;
  this.render(false);
}
async squeeze() {
  const str = this.gSTR;
  const dice = Math.floor(str / 5); // STR/5 = damage dice

  const roll = new Roll(`${dice}d6`);
  await roll.evaluate({async: true});
  roll.toMessage({
    flavor: `${this.grappler.name} squeezes ${this.target.name} for ${dice}d6 Normal Damage`,
    speaker: null
  });

  // END cost
  const endCost = Math.ceil(str / 5);
  ui.notifications.info(`${this.grappler.name} spends ${endCost} END to Squeeze.`);
}

async throwTarget() {
  const gSTR = this.gSTR;
  const tSTR = this.tSTR;

  const distance = gSTR - tSTR;

  if (distance <= 0) {
    ui.notifications.warn(`${this.grappler.name} cannot throw ${this.target.name}; not enough STR.`);
    return;
  }

  ui.notifications.info(`${this.grappler.name} throws ${this.target.name} ${distance} meters!`);

  // Optional: Knockback damage
  const kbDice = Math.floor(distance / 2);
  if (kbDice > 0) {
    const roll = new Roll(`${kbDice}d6`);
    await roll.evaluate({async: true});
    roll.toMessage({
      flavor: `${this.target.name} takes ${kbDice}d6 Knockback Damage`,
      speaker: null
    });
  }

  this.release();
}

async pinTarget() {
  // Apply DCV 0 to target
  await this.target.actor.createEmbeddedDocuments("ActiveEffect", [{
    label: "Pinned (DCV 0)",
    icon: "icons/svg/anchor.svg",
    changes: [
      { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: 0 }
    ],
    origin: this.grappler.actor.uuid
  }]);

  // Apply half DCV to grappler
  const halfDCV = Math.floor(this.grappler.actor.system.characteristics.dcv.value / 2);

  await this.grappler.actor.createEmbeddedDocuments("ActiveEffect", [{
    label: "Pinning (½ DCV)",
    icon: "icons/svg/anchor.svg",
    changes: [
      { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: halfDCV }
    ],
    origin: this.target.actor.uuid
  }]);

  ui.notifications.info(`${this.grappler.name} pins ${this.target.name}!`);
}

async dragTarget() {
  const gSTR = this.gSTR;
  const tSTR = this.tSTR;

  let move = this.grappler.actor.system.movement.run.value / 2;

  if (tSTR > gSTR) move = Math.floor(move / 2);

  ui.notifications.info(`${this.grappler.name} drags ${this.target.name} up to ${move} meters this Phase.`);
}
  async breakFree() {
    const g = await this._roll3d6(this.grappler, this.gSTR, `${this.grappler.name} STR Roll`);
    const t = await this._roll3d6(this.target, this.tSTR, `${this.target.name} STR Roll`);

    this.lastG = g.total;
    this.lastT = t.total;

    if (t.total > g.total) {
      ui.notifications.info(`${this.target.name} BREAKS FREE!`);
      this.release();
    } else {
      ui.notifications.warn(`${this.target.name} fails to break free.`);
      this.render(false);
    }
  }

  async release() {
    const effect = this.target.actor.effects.find(e => e.label === "Grabbed (-2 DCV)");
    if (effect) await effect.delete();
    this.close();
  }
}

export async function run() {
  if (canvas.tokens.controlled.length !== 1) {
    ui.notifications.warn("Select exactly ONE grappler token.");
    return;
  }

  const grappler = canvas.tokens.controlled[0];
  const grapplerActor = grappler.actor;
  if (!grapplerActor) {
    ui.notifications.warn("Selected grappler has no actor.");
    return;
  }

  const targets = canvas.tokens.placeables.filter(t => t.id !== grappler.id);
  if (!targets.length) {
    ui.notifications.warn("No other tokens found to grab.");
    return;
  }

  const options = targets.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

  new Dialog({
    title: "Choose Grapple Target",
    content: `<p><strong>Grappler:</strong> ${grappler.name}</p><p>Select the target you are grabbing:</p><select id="grabTarget">${options}</select>`,
    buttons: {
      ok: {
        label: "Grab",
        callback: async (html) => {
          const targetId = html.find("#grabTarget").val();
          const target = canvas.tokens.get(targetId);
          if (!target) {
            ui.notifications.error("Selected target not found.");
            return;
          }
          const targetActor = target.actor;
          if (!targetActor) {
            ui.notifications.error("Target has no actor.");
            return;
          }

          await targetActor.createEmbeddedDocuments("ActiveEffect", [{
            label: "Grabbed (-2 DCV)",
            icon: "icons/svg/net.svg",
            changes: [{ key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -2 }],
            origin: grapplerActor.uuid
          }]);

          const gSTR = grapplerActor.system.characteristics.str.value;
          const tSTR = targetActor.system.characteristics.str.value;

          const tracker = new GrappleTracker(grappler, target, gSTR, tSTR);
          tracker.render(true);
        }
      },
      cancel: { label: "Cancel" }
    }
  }).render(true);
}