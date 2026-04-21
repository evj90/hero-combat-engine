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

const MODULE_ID = "hero-combat-engine";
const GRAPPLE_FLAG = "grapple";
const GRAPPLE_EFFECT_TYPES = {
  grabbed: "grabbed",
  targetPinned: "targetPinned",
  grapplerPinning: "grapplerPinning"
};

function getPairKey(grappler, target) {
  return `${grappler.document.uuid}->${target.document.uuid}`;
}

function canModifyActor(actor) {
  if (!actor) return false;
  if (game.user?.isGM) return true;
  if (typeof actor.canUserModify === "function") {
    return actor.canUserModify(game.user, "update");
  }
  return Boolean(actor.isOwner);
}

function getGrappleState(effect) {
  return effect?.getFlag?.(MODULE_ID, GRAPPLE_FLAG) ?? null;
}

function getGrappleEffects(actor, pairKey, type) {
  return (actor?.effects ?? []).filter(effect => {
    const state = getGrappleState(effect);
    return state?.pairKey === pairKey && (!type || state.type === type);
  });
}

async function deleteEffects(effects) {
  for (const effect of effects) {
    await effect.delete();
  }
}

function createGrappleEffectData({ label, icon, changes, pairKey, type, grappler, target, appliedDelta = null }) {
  return {
    label,
    icon,
    changes,
    origin: grappler.actor?.uuid,
    flags: {
      [MODULE_ID]: {
        [GRAPPLE_FLAG]: {
          pairKey,
          type,
          grapplerActorUuid: grappler.actor?.uuid,
          grapplerTokenUuid: grappler.document.uuid,
          targetActorUuid: target.actor?.uuid,
          targetTokenUuid: target.document.uuid,
          appliedDelta
        }
      }
    }
  };
}

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
    this.pairKey = getPairKey(grappler, target);

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

  async _render(force, options) {
    await super._render(force, options);
    await this.syncPinEffects();
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

  async clearEffects(types = []) {
    const scopedTypes = Array.isArray(types) && types.length ? new Set(types) : null;
    const targetEffects = getGrappleEffects(this.target.actor, this.pairKey).filter(effect => {
      if (!scopedTypes) return true;
      return scopedTypes.has(getGrappleState(effect)?.type);
    });
    const grapplerEffects = getGrappleEffects(this.grappler.actor, this.pairKey).filter(effect => {
      if (!scopedTypes) return true;
      return scopedTypes.has(getGrappleState(effect)?.type);
    });

    await deleteEffects(targetEffects);
    await deleteEffects(grapplerEffects);
  }

  async syncPinEffects() {
    const targetPinned = getGrappleEffects(this.target.actor, this.pairKey, GRAPPLE_EFFECT_TYPES.targetPinned)[0];
    if (targetPinned) {
      const state = getGrappleState(targetPinned) ?? {};
      const currentDcv = Number(this.target.actor?.system?.characteristics?.dcv?.value ?? 0);
      const previousDelta = Number(state.appliedDelta ?? 0);
      const baseDcv = currentDcv - previousDelta;
      const nextDelta = -Math.max(0, baseDcv);
      if (nextDelta !== previousDelta) {
        await targetPinned.update({
          changes: [
            { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: nextDelta }
          ],
          [`flags.${MODULE_ID}.${GRAPPLE_FLAG}.appliedDelta`]: nextDelta
        });
      }
    }

    const grapplerPinning = getGrappleEffects(this.grappler.actor, this.pairKey, GRAPPLE_EFFECT_TYPES.grapplerPinning)[0];
    if (grapplerPinning) {
      const state = getGrappleState(grapplerPinning) ?? {};
      const currentDcv = Number(this.grappler.actor?.system?.characteristics?.dcv?.value ?? 0);
      const previousDelta = Number(state.appliedDelta ?? 0);
      const baseDcv = currentDcv - previousDelta;
      const nextValue = Math.floor(Math.max(0, baseDcv) / 2);
      const nextDelta = nextValue - baseDcv;
      if (nextDelta !== previousDelta) {
        await grapplerPinning.update({
          changes: [
            { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: nextDelta }
          ],
          [`flags.${MODULE_ID}.${GRAPPLE_FLAG}.appliedDelta`]: nextDelta
        });
      }
    }
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

  if (dice <= 0) {
    ui.notifications.warn(`${this.grappler.name} does not have enough STR to squeeze for damage.`);
    return;
  }

  const roll = new Roll(`${dice}d6`);
  await roll.evaluate({async: true});
  await roll.toMessage({
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
    await roll.toMessage({
      flavor: `${this.target.name} takes ${kbDice}d6 Knockback Damage`,
      speaker: null
    });
  }

  await this.release();
}

async pinTarget() {
  await this.clearEffects([GRAPPLE_EFFECT_TYPES.targetPinned, GRAPPLE_EFFECT_TYPES.grapplerPinning]);

  const targetBaseDcv = Number(this.target.actor.system?.characteristics?.dcv?.value ?? 0);
  const targetDelta = -Math.max(0, targetBaseDcv);
  const grapplerBaseDcv = Number(this.grappler.actor.system?.characteristics?.dcv?.value ?? 0);
  const halfDcv = Math.floor(Math.max(0, grapplerBaseDcv) / 2);
  const grapplerDelta = halfDcv - grapplerBaseDcv;

  await this.target.actor.createEmbeddedDocuments("ActiveEffect", [createGrappleEffectData({
    label: "Pinned (DCV 0)",
    icon: "icons/svg/anchor.svg",
    changes: [
      { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: targetDelta }
    ],
    pairKey: this.pairKey,
    type: GRAPPLE_EFFECT_TYPES.targetPinned,
    grappler: this.grappler,
    target: this.target,
    appliedDelta: targetDelta
  })]);

  await this.grappler.actor.createEmbeddedDocuments("ActiveEffect", [createGrappleEffectData({
    label: "Pinning (½ DCV)",
    icon: "icons/svg/anchor.svg",
    changes: [
      { key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: grapplerDelta }
    ],
    pairKey: this.pairKey,
    type: GRAPPLE_EFFECT_TYPES.grapplerPinning,
    grappler: this.grappler,
    target: this.target,
    appliedDelta: grapplerDelta
  })]);

  await this.syncPinEffects();

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
      await this.release();
    } else {
      ui.notifications.warn(`${this.target.name} fails to break free.`);
      this.render(false);
    }
  }

  async release() {
    await this.clearEffects();
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

  const targets = canvas.tokens.placeables.filter(t => t.id !== grappler.id && t.actor && canModifyActor(t.actor));
  if (!targets.length) {
    ui.notifications.warn("No writable target tokens found to grab.");
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

          if (!canModifyActor(targetActor)) {
            ui.notifications.error(`You do not have permission to apply grapple effects to ${target.name}.`);
            return;
          }

          const pairKey = getPairKey(grappler, target);
          await deleteEffects(getGrappleEffects(targetActor, pairKey));
          await deleteEffects(getGrappleEffects(grapplerActor, pairKey));

          await targetActor.createEmbeddedDocuments("ActiveEffect", [createGrappleEffectData({
            label: "Grabbed (-2 DCV)",
            icon: "icons/svg/net.svg",
            changes: [{ key: "system.characteristics.dcv.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: -2 }],
            pairKey,
            type: GRAPPLE_EFFECT_TYPES.grabbed,
            grappler,
            target,
            appliedDelta: -2
          })]);

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