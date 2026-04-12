import { getActingTokens } from "./segment-engine.js";

// ── Quick-toggle status conditions shown in the tracker ─────────
// IDs match Foundry v11 core CONFIG.statusEffects keys.
// fallbackIcon is used if the status isn't found in CONFIG.statusEffects.
const HERO_QUICK_STATUSES = [
  { id: "prone",       label: "Prone — −2 OCV/DCV, half phase to stand",        fallbackIcon: "icons/svg/falling.svg"     },
  { id: "blind",       label: "Flashed (Sight) — sight blocked",                 fallbackIcon: "icons/svg/blind.svg"       },
  { id: "deaf",        label: "Flashed (Hearing) — hearing blocked",              fallbackIcon: "icons/svg/deaf.svg"        },
  { id: "restrain",    label: "Entangled — movement restricted",                  fallbackIcon: "icons/svg/net.svg"         },
];

const COVER_STAGES = [
  { dcv: 0, label: "None" },
  { dcv: 1, label: "Some" },
  { dcv: 2, label: "Half" },
  { dcv: 3, label: "Good" }
];

function getCoverStage(dcv) {
  return COVER_STAGES.find(s => s.dcv === dcv) ?? COVER_STAGES[0];
}

function normalizeFadeInterval(interval) {
  return interval === "segment" ? "segment" : "phase";
}

function isEntangleStatus(statusId) {
  return statusId === "restrain" || statusId === "entangle";
}

function getActiveEntangleStatusIds(actor) {
  const activeIDs = actor?.statuses ?? new Set(actor?.effects?.flatMap(e => [...(e.statuses ?? [])]) ?? []);
  return ["restrain", "entangle"].filter(id => activeIDs.has(id));
}

function getPreferredEntangleStatusId(actor) {
  const active = getActiveEntangleStatusIds(actor);
  if (active.includes("restrain")) return "restrain";
  if (active.includes("entangle")) return "entangle";

  const statusIds = new Set((CONFIG.statusEffects ?? []).map(e => e.id));
  if (statusIds.has("restrain")) return "restrain";
  if (statusIds.has("entangle")) return "entangle";
  return "restrain";
}

function getNestedValue(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getEntangleAttackOptions(actor) {
  const options = [];
  const strValue = asNumber(actor?.system?.characteristics?.str?.value, 0);
  options.push({
    id: "builtin-str",
    label: `STR (${strValue})`,
    ocvMod: 0,
    damageFormula: "",
    source: "builtin"
  });

  for (const item of actor?.items ?? []) {
    const itemType = String(item.type ?? "").toLowerCase();
    const typeLooksAttacky = /(attack|weapon|maneuver|power|spell)/i.test(itemType);
    const hasAttackKeyword = /(attack|strike|blast|entangle|punch|kick|hka|rka)/i.test(item.name ?? "");
    const hasAttackBlock = getNestedValue(item, "system.attack") != null;

    const ocvMod = asNumber(
      getNestedValue(item, "system.ocvMod")
        ?? getNestedValue(item, "system.attack.ocvMod")
        ?? getNestedValue(item, "system.attack.ocv")
        ?? getNestedValue(item, "system.toHitMod")
        ?? getNestedValue(item, "system.cv.ocv")
        ?? 0,
      0
    );

    const damageFormulaRaw =
      getNestedValue(item, "system.damage")
      ?? getNestedValue(item, "system.damageFormula")
      ?? getNestedValue(item, "system.attack.damage")
      ?? getNestedValue(item, "system.effect.damage")
      ?? getNestedValue(item, "system.formula")
      ?? "";

    const damageFormula = String(damageFormulaRaw ?? "").trim();
    const looksLikeFormula = /^\s*[0-9dD+\-*/()\s]+$/.test(damageFormula) && /\d+d\d+/i.test(damageFormula);
    const hasAttackIndicators = typeLooksAttacky || hasAttackKeyword || hasAttackBlock;
    const hasUsableRollData = Boolean(ocvMod) || looksLikeFormula || Boolean(getNestedValue(item, "system.attack.damage"));
    if (!hasAttackIndicators || !hasUsableRollData) continue;

    options.push({
      id: `item-${item.id}`,
      label: item.name ?? "Unnamed Attack",
      ocvMod,
      damageFormula: looksLikeFormula ? damageFormula : "",
      source: "item"
    });
  }

  options.push({
    id: "custom-manual",
    label: "Custom Attack (manual damage)",
    ocvMod: 0,
    damageFormula: "",
    source: "custom"
  });

  return options;
}

function getMCVUpdateData(actor, delta) {
  if (!delta) return {};

  const chars = actor.system?.characteristics ?? {};
  const updates = {};

  if (chars.mcv?.value != null) {
    updates["system.characteristics.mcv.value"] = (chars.mcv.value ?? 0) + delta;
    return updates;
  }

  if (chars.dmcv?.value != null) updates["system.characteristics.dmcv.value"] = (chars.dmcv.value ?? 0) + delta;
  if (chars.omcv?.value != null) updates["system.characteristics.omcv.value"] = (chars.omcv.value ?? 0) + delta;
  if (Object.keys(updates).length) return updates;

  updates["system.characteristics.mcv.value"] = delta;
  return updates;
}

function statBucket(value, max, cfg) {
  if (max <= 0 || value <= 0) return { label: "Out",  color: cfg.colorOut, isOut: true };
  const pct = value / max;
  if (pct >= 1.0)        return { label: "Full", color: cfg.colorFull };
  if (pct >= cfg.lessAt) return { label: "Less", color: cfg.colorLess };
  if (pct >= cfg.halfAt) return { label: "Half", color: cfg.colorHalf };
  if (pct >= cfg.hurtAt) return { label: "Hurt", color: cfg.colorHurt };
  return                        { label: "Risk", color: cfg.colorRisk };
}

const BUCKET_PIPS = { Full: 5, Less: 4, Half: 3, Hurt: 2, Risk: 1, Out: 0 };
const DEFAULT_BUCKET_DESC = {
  _default: {
    Full: "at full value",
    Less: "slightly reduced",
    Half: "at about half value",
    Hurt: "significantly reduced",
    Risk: "critically low",
    Out: "depleted"
  },
  stun: { Full: "fully alert", Less: "slightly winded", Half: "noticeably hurt", Hurt: "badly hurt", Risk: "near unconsciousness", Out: "unconscious" },
  body: { Full: "uninjured", Less: "lightly wounded", Half: "seriously wounded", Hurt: "gravely wounded", Risk: "near death", Out: "dead or dying" },
  end:  { Full: "fully energized", Less: "slightly tired", Half: "noticeably fatigued", Hurt: "severely exhausted", Risk: "nearly depleted", Out: "completely exhausted" },
  pre:  { Full: "commanding presence", Less: "still impressive", Half: "shaken confidence", Hurt: "visibly unsettled", Risk: "nearly cowed", Out: "presence depleted" }
};

function getBucketDescriptions() {
  const loaded = game.heroCombat?.bucketDescriptions;
  if (loaded && typeof loaded === "object") return loaded;
  return DEFAULT_BUCKET_DESC;
}

function getBucketDescription(charKey, bucketLabel) {
  const table = getBucketDescriptions();
  const charTable = table[charKey] ?? table._default ?? DEFAULT_BUCKET_DESC._default;
  return charTable?.[bucketLabel] ?? bucketLabel;
}

function getTrackedPipCharacteristics() {
  const raw = game.settings.get("hero-combat-engine", "trackedPipCharacteristics") ?? "";
  if (!raw.trim()) {
    return ["stun", "body", "end"];
  }

  const parsed = raw
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => s.replace(/[^a-z0-9_]/g, ""));

  return [...new Set(parsed)];
}

function pipsArray(label) {
  const n = BUCKET_PIPS[label] ?? 0;
  return Array.from({ length: 5 }, (_, i) => i < n);
}

// Returns true for GameMaster, Assistant GM, and Trusted players.
function isPrivileged() {
  return game.user.isGM || game.user.role >= CONST.USER_ROLES.TRUSTED;
}

export class HeroControllerPanel extends Application {
  get title() {
    return "HERO Combat Engine";
  }

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      id: "hero-controller-panel",
      popOut: true,
      resizable: true,
      width: 400,
      height: "auto",
      template: "modules/hero-combat-engine/templates/controller-panel.html"
    });
  }

  getData() {
    const settingSize = game.settings.get("hero-combat-engine", "accessibilitySize") ?? "compact";
    const legacyExpanded = game.settings.get("hero-combat-engine", "expandedAccessibility") ?? false;
    const accessibilitySize = ["compact", "medium", "large"].includes(settingSize)
      ? settingSize
      : (legacyExpanded ? "medium" : "compact");
    const accessibilityClass = accessibilitySize === "compact" ? "" : ` a11y-${accessibilitySize}`;

    if (!canvas?.scene) return {
      phase: 1, segment: 1, isGM: isPrivileged(),
      accessibilityClass,
      showSpdColumn: false, hideNonActing: false, actingSPDs: [],
      combatants: [], hasCombatants: false, currentActingTokenId: null, hasStaleTokens: false, staleCount: 0, stalePlural: false
    };
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    const currentActingIndex = canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0;
    const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
    const showSpdColumn = game.settings.get("hero-combat-engine", "showSpdColumn");
    const trackedPipCharacteristics = getTrackedPipCharacteristics();
    const playerSelfAdvance = game.settings.get("hero-combat-engine", "playerSelfAdvance");
    const hideNonActing = game.settings.get("hero-combat-engine", "hideNonActing");

    // Read stat config once — passed into statBucket to avoid N×6 settings reads per render
    const statConfig = {
      lessAt:    game.settings.get("hero-combat-engine", "statLessAt") / 100,
      halfAt:    game.settings.get("hero-combat-engine", "statHalfAt") / 100,
      hurtAt:    game.settings.get("hero-combat-engine", "statHurtAt") / 100,
      colorFull: game.settings.get("hero-combat-engine", "statColorFull"),
      colorLess: game.settings.get("hero-combat-engine", "statColorLess"),
      colorHalf: game.settings.get("hero-combat-engine", "statColorHalf"),
      colorHurt: game.settings.get("hero-combat-engine", "statColorHurt"),
      colorRisk: game.settings.get("hero-combat-engine", "statColorRisk"),
      colorOut:  game.settings.get("hero-combat-engine", "statColorOut"),
    };
    const staleCount = actingOrder.filter(id => !canvas.tokens.get(id)).length;
    const heldTokenIds    = new Set(canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens")    ?? []);
    const abortedTokenIds = new Set(canvas.scene.getFlag("hero-combat-engine", "hero-combat.abortedTokens") ?? []);

    // Which SPD values act in the current segment
    const actingSPDs = Object.entries(game.heroCombat?.SPD_MAP ?? {})
      .filter(([, segs]) => segs.includes(segment))
      .map(([spd]) => parseInt(spd))
      .sort((a, b) => a - b);

    // Tokens that act this segment, in turn order — used to determine "already acted"
    const actingThisSegment = getActingTokens(segment).map(t => t.id);
    const currentActingTokenId = actingThisSegment[currentActingIndex] ?? null;
    const alreadyActedIds = new Set(actingThisSegment.slice(0, currentActingIndex));

    const allCombatants = actingOrder.map(tokenId => {
      const token = canvas.tokens.get(tokenId);
      const actor = token?.actor;
      if (!token || !actor) return null;

      const spd = actor.system?.characteristics?.spd?.value ?? 0;
      const ocv = actor.system?.characteristics?.ocv?.value ?? 0;
      const dcv = actor.system?.characteristics?.dcv?.value ?? 0;
      const mcv = actor.system?.characteristics?.mcv?.value
        ?? actor.system?.characteristics?.dmcv?.value
        ?? actor.system?.characteristics?.omcv?.value
        ?? 0;
      const canActThisSegment = (game.heroCombat?.SPD_MAP?.[spd] ?? []).includes(segment);
      const isActing = token.id === currentActingTokenId;
      const hasActed = alreadyActedIds.has(token.id);

      const ownerIds = Object.entries(actor.ownership ?? {})
        .filter(([id, perm]) => id !== "default" && perm >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        .map(([id]) => id);
      const isOwnedByCurrentUser = ownerIds.includes(game.user.id);
      const allowEndTurn = isActing && (isPrivileged() || playerSelfAdvance || isOwnedByCurrentUser);
      const allowRemove = isPrivileged() || isOwnedByCurrentUser;
      const canSeeStats = isPrivileged() || isOwnedByCurrentUser;
      const isHeld    = heldTokenIds.has(token.id);
      const isAborted = abortedTokenIds.has(token.id);
      // allowHold: can act this segment, not already held, not yet done — includes the currently acting token
      const allowHold    = canActThisSegment && !hasActed && !isHeld && (isPrivileged() || isOwnedByCurrentUser);
      // allowRelease: token is held and it is not too late (segment still active)
      const allowRelease = isHeld && (isPrivileged() || isOwnedByCurrentUser);
      const allowAbort = canActThisSegment && !hasActed && !isActing && (isPrivileged() || isOwnedByCurrentUser);
      const statBars = trackedPipCharacteristics.map(charKey => {
        const c = actor.system?.characteristics?.[charKey];
        if (!c || (c.value == null && c.max == null)) return null;

        const value = Number(c.value ?? 0);
        let max = Number(c.max ?? 0);
        if (!Number.isFinite(max) || max <= 0) max = Math.max(Math.abs(value), 1);

        const bucket = statBucket(value, max, statConfig);
        const label = charKey.toUpperCase();
        return {
          key: charKey,
          label,
          bucket,
          pips: pipsArray(bucket.label),
          tooltip: `${label} — ${getBucketDescription(charKey, bucket.label)}`
        };
      }).filter(Boolean);

      const quickStatusIds = new Set(HERO_QUICK_STATUSES.map(s => s.id));
      const effects = (actor.effects ?? [])
        .filter(e => !e.disabled)
        .filter(e => ![...(e.statuses ?? [])].some(s => quickStatusIds.has(s)))
        .map(e => ({ icon: e.icon, label: e.name ?? e.label ?? "" }));

      let stateClass, statusText;
      if (isActing) {
        stateClass = "acting";
        statusText = "Acting";
      } else if (isHeld) {
        stateClass = "held";
        statusText = "Held";
      } else if (hasActed) {
        stateClass = "has-acted";
        statusText = "Done";
      } else if (canActThisSegment) {
        stateClass = "can-act";
        statusText = "Waiting to act";
      } else {
        stateClass = "waiting";
        statusText = "Not this segment";
      }

      const coverDCV = token.document.getFlag("hero-combat-engine", "coverDCV") ?? 0;
      const coverStage = getCoverStage(coverDCV);
      const cvMods = (token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? []).reduce((acc, mod) => {
        acc.ocv += mod.ocvMod ?? 0;
        acc.dcv += mod.dcvMod ?? 0;
        acc.mcv += mod.mcvMod ?? 0;
        return acc;
      }, { ocv: 0, dcv: 0, mcv: 0 });

      return {
        id: token.id,
        name: token.name,
        img: token.document.texture?.src || actor.img || "icons/svg/mystery-man.svg",
        spd,
        ocv, dcv, mcv,
        ocvTempActive: cvMods.ocv !== 0,
        dcvTempActive: cvMods.dcv !== 0,
        mcvTempActive: cvMods.mcv !== 0,
        ocvTempClass: cvMods.ocv > 0 ? "temp-buff" : (cvMods.ocv < 0 ? "temp-debuff" : ""),
        dcvTempClass: cvMods.dcv > 0 ? "temp-buff" : (cvMods.dcv < 0 ? "temp-debuff" : ""),
        mcvTempClass: cvMods.mcv > 0 ? "temp-buff" : (cvMods.mcv < 0 ? "temp-debuff" : ""),
        statBars,
        canSeeStats,
        effects,
        adjustments: (token.document.getFlag("hero-combat-engine", "adjustments") ?? []).map(a => {
          const fadeInterval = normalizeFadeInterval(a.fadeInterval);
          return {
            ...a,
            fadeInterval,
            fadeUnitLabel: fadeInterval === "segment" ? "Segment" : "Phase",
            isDrain: a.type === "drain"
          };
        }),
        isGM: isPrivileged(),
        isActing, isHeld, isAborted,
        allowEndTurn, allowRemove, allowHold, allowRelease, allowAbort,
        canActThisSegment,
        stateClass,
        statusText,
        quickStatuses: (() => {
          const activeIDs = actor.statuses ?? new Set(actor.effects.flatMap(e => [...(e.statuses ?? [])]));
          const cfgMap = Object.fromEntries((CONFIG.statusEffects ?? []).map(s => [s.id, s.icon]));
          return HERO_QUICK_STATUSES.map(s => {
            const active = activeIDs.has(s.id);
            const entry = {
              id: s.id,
              label: s.label,
              icon: cfgMap[s.id] ?? s.fallbackIcon,
              active,
              canToggle: isPrivileged() || isOwnedByCurrentUser
            };
            if (active) {
              if (s.id === "blind") entry.flashPoints = token.document.getFlag("hero-combat-engine", "flashPointsSight") ?? null;
              if (s.id === "deaf")  entry.flashPoints = token.document.getFlag("hero-combat-engine", "flashPointsHearing") ?? null;
            }
            return entry;
          });
        })(),
        coverDCV,
        coverStageLabel: coverStage.label,
        entangleBody: token.document.getFlag("hero-combat-engine", "entangleBody") ?? 0,
        canToggleCover: isPrivileged() || isOwnedByCurrentUser
      };
    }).filter(Boolean);
    const combatants = allCombatants.filter(c => !hideNonActing || c.canActThisSegment);

    return {
      phase,
      segment,
      isGM: isPrivileged(),
      accessibilityClass,
      showSpdColumn,
      hideNonActing,
      actingSPDs,
      combatants,
      hasCombatants: allCombatants.length > 0,
      currentActingTokenId,
      staleCount,
      hasStaleTokens: staleCount > 0,
      stalePlural: staleCount !== 1
    };
  }

  activateListeners(html) {
    html.find(".combatant").dblclick((e) => {
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (token?.actor) token.actor.sheet.render(true);
    });

    html.find(".hero-end-segment").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      try {
        if (isPrivileged()) {
          if (game.heroCombat?.endTokenSegment) {
            await game.heroCombat.endTokenSegment(tokenId);
          }
        } else {
          game.socket.emit("module.hero-combat-engine", { type: "end-turn", tokenId, userId: game.user.id });
        }
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] endTokenSegment failed:", err);
      }
    });

    html.find("#hero-prev-segment").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.previousSegment) await game.heroCombat.previousSegment();
      } catch (err) {
        console.error("[HERO ERROR] previousSegment failed:", err);
      }
    });

    html.find("#hero-next-segment").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.segmentAdvance) await game.heroCombat.segmentAdvance();
      } catch (err) {
        console.error("[HERO ERROR] segmentAdvance failed:", err);
      }
    });

    html.find("#hero-prev-token").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.previousActingToken) await game.heroCombat.previousActingToken();
      } catch (err) {
        console.error("[HERO ERROR] previousActingToken failed:", err);
      }
    });

    html.find("#hero-next-token").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.nextActingToken) await game.heroCombat.nextActingToken();
      } catch (err) {
        console.error("[HERO ERROR] nextActingToken failed:", err);
      }
    });

    html.find("#hero-begin-combat").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.beginCombat) await game.heroCombat.beginCombat();
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] beginCombat failed:", err);
      }
    });

    html.find("#hero-add-selected").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.addSelectedTokens) await game.heroCombat.addSelectedTokens();
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] addSelectedTokens failed:", err);
      }
    });

    html.find("#hero-remove-selected").click(async (e) => {
      e.preventDefault();
      const selected = canvas.tokens.controlled;
      if (!selected.length) {
        ui.notifications.warn("Select at least one token to remove from combat.");
        return;
      }
      const confirmed = await Dialog.confirm({
        title: "Remove from Combat",
        content: `<p>Remove ${selected.length} selected token${selected.length !== 1 ? "s" : ""} from the combat order?</p>`
      });
      if (!confirmed) return;
      for (const token of selected) {
        await this._removeToken(token.id);
      }
      await this.render(true);
    });

    html.find("#hero-highlight").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.highlightActing) await game.heroCombat.highlightActing({ temporaryOnly: true });
      } catch (err) {
        console.error("[HERO ERROR] highlightActing failed:", err);
      }
    });

    html.find("#hero-toggle-hide-non-acting").click(async (e) => {
      e.preventDefault();
      const current = game.settings.get("hero-combat-engine", "hideNonActing");
      await game.settings.set("hero-combat-engine", "hideNonActing", !current);
      await this.render(true);
    });

    html.find("#hero-end-combat").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.endCombat) await game.heroCombat.endCombat();
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] endCombat failed:", err);
      }
    });

    html.find(".hero-ping-token").click((e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token) return;
      canvas.ping(token.center);
    });

    html.find(".hero-pan-token").click((e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token) return;
      canvas.animatePan({ x: token.center.x, y: token.center.y, scale: Math.max(1, canvas.stage.scale.x), duration: 250 });
    });

    html.find(".hero-remove-combatant").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const confirmed = await Dialog.confirm({
        title: "Remove from Combat",
        content: `<p>Remove this token from the combat order?</p>`
      });
      if (!confirmed) return;
      if (isPrivileged()) {
        await this._removeToken(tokenId);
      } else {
        game.socket.emit("module.hero-combat-engine", { type: "remove-combatant", tokenId, userId: game.user.id });
      }
    });

    html.find(".hero-take-recovery").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (isPrivileged()) {
        await this._applyRecovery(tokenId);
      } else {
        game.socket.emit("module.hero-combat-engine", { type: "take-recovery", tokenId, userId: game.user.id });
      }
    });

    html.find("#hero-refresh-order").click(async (e) => {
      e.preventDefault();
      try {
        if (game.heroCombat?.refreshCombatOrder) await game.heroCombat.refreshCombatOrder();
      } catch (err) {
        console.error("[HERO ERROR] refreshCombatOrder failed:", err);
      }
    });

    html.find(".hero-hold-token").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (isPrivileged()) {
        await game.heroCombat.holdToken(tokenId);
      } else {
        game.socket.emit("module.hero-combat-engine", { type: "hold-token", tokenId, userId: game.user.id });
      }
    });

    html.find(".hero-release-hold").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (isPrivileged()) {
        await game.heroCombat.releaseHold(tokenId);
      } else {
        game.socket.emit("module.hero-combat-engine", { type: "release-hold", tokenId, userId: game.user.id });
      }
    });

    html.find(".hero-abort-token").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (isPrivileged()) {
        await this._toggleAbort(tokenId);
      } else {
        game.socket.emit("module.hero-combat-engine", { type: "toggle-abort", tokenId, userId: game.user.id });
      }
    });

    html.find(".hero-status-btn.active").on("contextmenu", async (e) => {
      e.preventDefault();
      const tokenId  = e.currentTarget.dataset.tokenId;
      const statusId = e.currentTarget.dataset.statusId;
      await this._openStatusTrackerDialog(tokenId, statusId);
    });

    html.find(".hero-adjustment-badge").on("contextmenu", async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const adjId   = e.currentTarget.dataset.adjId;
      await this._openAdjustmentDialog(tokenId, adjId);
    });

    html.find(".hero-add-adjustment").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      await this._openAddAdjustmentDialog(tokenId);
    });

    html.find(".hero-entangle-badge").on("contextmenu", async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      await this._openEntangleDialog(tokenId, getPreferredEntangleStatusId(token?.actor));
    });

    // Use native addEventListener so the contextmenu event reaches us regardless
    // of any jQuery-layer interception that was swallowing it previously.
    html.find(".hero-cv-stack").each((_, el) => {
      el.addEventListener("contextmenu", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this._openCvAdjustmentDialog(el.dataset.tokenId);
      });
    });

    html.find(".hero-cover-btn").click(async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      const current = token.document.getFlag("hero-combat-engine", "coverDCV") ?? 0;
      const currentIdx = COVER_STAGES.findIndex(s => s.dcv === current);
      const nextStage = COVER_STAGES[(currentIdx + 1) % COVER_STAGES.length];
      const actorDcv = token.actor.system?.characteristics?.dcv?.value ?? 0;

      await token.actor.update({ "system.characteristics.dcv.value": actorDcv - current + nextStage.dcv });

      if (nextStage.dcv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "coverDCV");
      } else {
        await token.document.setFlag("hero-combat-engine", "coverDCV", nextStage.dcv);
      }

      const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
      const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
      ChatMessage.create({ speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> cover: ${nextStage.label}${nextStage.dcv > 0 ? ` (+${nextStage.dcv} DCV)` : ""}.` });

      await this.render(true);
    });

    html.find(".hero-cover-btn").on("contextmenu", async (e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      await this._openCoverDialog(tokenId);
    });

    html.find(".hero-status-btn").click(async (e) => {
      e.preventDefault();
      const tokenId  = e.currentTarget.dataset.tokenId;
      const statusId = e.currentTarget.dataset.statusId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;

      const isCurrentlyActive = e.currentTarget.classList.contains("active");

      // Flash blindness: prompt for Flash Points when toggling on.
      if (statusId === "blind" && !isCurrentlyActive) {
        const fd = token.actor.system?.characteristics?.fd?.value ?? 0;
        const fp = await new Promise(resolve => {
          new Dialog({
            title: "Flash Blindness",
            content: `
              <p>Enter Flash Points applied to <strong>${token.name}</strong> (after Flash Defense).</p>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <label style="flex-shrink:0;">Flash Points:</label>
                <input type="number" id="fp-input" value="3" min="1" style="width:64px;" autofocus/>
              </div>
              <p style="margin-top:4px;font-size:0.85em;color:var(--color-text-dark-secondary);">Recovers <strong>1 FP per segment</strong>.${fd > 0 ? ` Flash Defense ${fd} reduces the initial FP applied.` : ""}</p>
            `,
            buttons: {
              apply: {
                label: "Apply",
                callback: html => resolve(parseInt(html.find("#fp-input").val()) || 0)
              },
              cancel: { label: "Cancel", callback: () => resolve(null) }
            },
            default: "apply"
          }).render(true);
        });
        if (!fp || fp < 1) return;
        await token.document.setFlag("hero-combat-engine", "flashPointsSight", fp);
      } else if (statusId === "blind" && isCurrentlyActive) {
        // Toggling off manually — clear flash points tracking.
        await token.document.unsetFlag("hero-combat-engine", "flashPointsSight");
      }

      // ── Flash Hearing (deaf) ──────────────────────────────────────
      if (statusId === "deaf" && !isCurrentlyActive) {
        const fd = token.actor.system?.characteristics?.fd?.value ?? 0;
        const fp = await new Promise(resolve => {
          new Dialog({
            title: "Flash Deafness",
            content: `
              <p>Enter Flash Points applied to <strong>${token.name}</strong> (Hearing, after Flash Defense).</p>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <label style="flex-shrink:0;">Flash Points:</label>
                <input type="number" id="fp-input" value="3" min="1" style="width:64px;" autofocus/>
              </div>
              <p style="margin-top:4px;font-size:0.85em;color:var(--color-text-dark-secondary);">Recovers <strong>1 FP per segment</strong>.${fd > 0 ? ` Flash Defense ${fd} reduces the initial FP applied.` : ""}</p>
            `,
            buttons: {
              apply: { label: "Apply", callback: html => resolve(parseInt(html.find("#fp-input").val()) || 0) },
              cancel: { label: "Cancel", callback: () => resolve(null) }
            },
            default: "apply"
          }).render(true);
        });
        if (!fp || fp < 1) return;
        await token.document.setFlag("hero-combat-engine", "flashPointsHearing", fp);
      } else if (statusId === "deaf" && isCurrentlyActive) {
        await token.document.unsetFlag("hero-combat-engine", "flashPointsHearing");
      }

      // ── Entangle (restrain) BODY tracking ─────────────────────────
      if (isEntangleStatus(statusId) && !isCurrentlyActive) {
        const body = await new Promise(resolve => {
          new Dialog({
            title: "Entangle BODY",
            content: `
              <p>Enter Entangle BODY for <strong>${token.name}</strong>.</p>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <label style="flex-shrink:0;">BODY:</label>
                <input type="number" id="ent-body-input" value="6" min="1" style="width:64px;" autofocus/>
              </div>
            `,
            buttons: {
              apply: { label: "Apply", callback: html => resolve(parseInt(html.find("#ent-body-input").val()) || 0) },
              cancel: { label: "Cancel", callback: () => resolve(null) }
            },
            default: "apply"
          }).render(true);
        });
        if (!body || body < 1) return;
        await token.document.setFlag("hero-combat-engine", "entangleBody", body);
      } else if (isEntangleStatus(statusId) && isCurrentlyActive) {
        await token.document.unsetFlag("hero-combat-engine", "entangleBody");
      }

      // toggleStatusEffect may not exist on all actor types in v11; use
      // token.toggleEffect with the full status object as the reliable fallback.
      const effectData = CONFIG.statusEffects.find(e => e.id === statusId);
      if (!effectData) return;
      if (typeof token.actor.toggleStatusEffect === "function") {
        await token.actor.toggleStatusEffect(statusId);
      } else {
        await token.toggleEffect(effectData);
      }
      await this.render(true);
    });
  }

  async _openStatusTrackerDialog(tokenId, statusId) {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token || !actor) return;
    if (!isPrivileged() && !actor.isOwner) return;

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    // ── Flash (Sight / Hearing) ───────────────────────────────────
    if (statusId === "blind" || statusId === "deaf") {
      const isSight   = statusId === "blind";
      const flagKey   = isSight ? "flashPointsSight" : "flashPointsHearing";
      const senseName = isSight ? "Sight" : "Hearing";
      const fps = token.document.getFlag("hero-combat-engine", flagKey) ?? 0;

      const result = await new Promise(resolve => {
        new Dialog({
          title: `Flash (${senseName}) — ${token.name}`,
          content: `
            <div style="display:grid;gap:6px;margin-top:4px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <label style="min-width:120px;flex-shrink:0;">Flash Points remaining:</label>
                <input type="number" id="fp-input" value="${fps}" min="0" style="width:70px;" autofocus/>
              </div>
              <p style="font-size:0.85em;margin:0;color:var(--color-text-dark-secondary);">
                Recovers <strong>1 FP per segment</strong>. Current: Segment ${phase}.${segment}
              </p>
            </div>
          `,
          buttons: {
            update: {
              icon: '<i class="fas fa-save"></i>',
              label: "Update",
              callback: html => resolve({ action: "update", fp: parseInt(html.find("#fp-input").val()) || 0 })
            },
            remove: {
              icon: '<i class="fas fa-times"></i>',
              label: "Remove Effect",
              callback: () => resolve({ action: "remove" })
            },
            cancel: { label: "Cancel", callback: () => resolve(null) }
          },
          default: "update"
        }).render(true);
      });

      if (!result) return;

      if (result.action === "update") {
        if (result.fp <= 0) {
          await token.document.unsetFlag("hero-combat-engine", flagKey);
          ChatMessage.create({ speaker: { alias: "Combat Engine" },
            content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Flash (${senseName}) cleared manually.` });
          // Remove the status effect
          const effectData = CONFIG.statusEffects?.find(e => e.id === statusId);
          if (effectData) {
            if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(statusId);
            else await token.toggleEffect(effectData);
          }
        } else {
          const fd = actor.system?.characteristics?.fd?.value ?? 0;
          await token.document.setFlag("hero-combat-engine", flagKey, result.fp);
          ChatMessage.create({ speaker: { alias: "Combat Engine" },
            content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Flash (${senseName}): ${result.fp} FP remaining (FD ${fd}, recovers 1/segment).` });
        }
      } else if (result.action === "remove") {
        await token.document.unsetFlag("hero-combat-engine", flagKey);
        const effectData = CONFIG.statusEffects?.find(e => e.id === statusId);
        if (effectData) {
          if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(statusId);
          else await token.toggleEffect(effectData);
        }
        ChatMessage.create({ speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Flash (${senseName}) removed.` });
      }

      await this.render(true);
      return;
    }

    // ── Entangle (restrain) BODY tracker ───────────────────────────
    if (isEntangleStatus(statusId)) {
      await this._openEntangleDialog(tokenId, statusId);
      return;
    }

    // ── Stunned ───────────────────────────────────────────────────
    if (statusId === "stun") {
      const confirmed = await Dialog.confirm({
        title: `Stunned — ${token.name}`,
        content: `<p><strong>${token.name}</strong> is Stunned.<br>A Stunned character may take no actions until the end of their next Phase.<br><br>Remove the Stunned condition now?</p>`
      });
      if (!confirmed) return;
      const effectData = CONFIG.statusEffects?.find(e => e.id === "stun");
      if (effectData) {
        if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect("stun");
        else await token.toggleEffect(effectData);
      }
      ChatMessage.create({ speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> recovers from Stun.` });
      await this.render(true);
      return;
    }

    // ── All other active statuses — generic info + remove ─────────
    const statusMeta = HERO_QUICK_STATUSES.find(s => s.id === statusId);
    const confirmed = await Dialog.confirm({
      title: `${statusMeta?.label?.split("—")[0]?.trim() ?? statusId} — ${token.name}`,
      content: `<p>${statusMeta?.label ?? statusId}</p><p>Remove this condition from <strong>${token.name}</strong>?</p>`
    });
    if (!confirmed) return;
    const effectData = CONFIG.statusEffects?.find(e => e.id === statusId);
    if (effectData) {
      if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(statusId);
      else await token.toggleEffect(effectData);
    }
    ChatMessage.create({ speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong>: ${statusMeta?.label?.split("—")[0]?.trim() ?? statusId} removed.` });
    await this.render(true);
  }

  async _openCoverDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return;
    const current = token.document.getFlag("hero-combat-engine", "coverDCV") ?? 0;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    const result = await new Promise(resolve => {
      new Dialog({
        title: `Cover — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">Select the temporary DCV bonus granted by cover.</p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:100px;flex-shrink:0;">DCV bonus:</label>
              <select id="cover-dcv" style="flex:1;">
                <option value="0"${current === 0 ? " selected" : ""}>None (+0 DCV)</option>
                <option value="1"${current === 1 ? " selected" : ""}>Some (+1 DCV)</option>
                <option value="2"${current === 2 ? " selected" : ""}>Half (+2 DCV)</option>
                <option value="3"${current === 3 ? " selected" : ""}>Good (+3 DCV)</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-shield-halved"></i>',
            label: current > 0 ? "Update" : "Apply",
            callback: html => resolve({ action: "apply", dcv: parseInt(html.find("#cover-dcv").val()) })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "apply"
      }).render(true);
    });

    if (!result) return;

    const actorDcv = token.actor.system?.characteristics?.dcv?.value ?? 0;

    if (result.action === "apply") {
      // Adjust: remove old bonus first, then apply new
      const adjustedDcv = actorDcv - current + result.dcv;
      await token.actor.update({ "system.characteristics.dcv.value": adjustedDcv });
      if (result.dcv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "coverDCV");
      } else {
        await token.document.setFlag("hero-combat-engine", "coverDCV", result.dcv);
      }
      const stage = getCoverStage(result.dcv);
      ChatMessage.create({ speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> cover: ${stage.label}${stage.dcv > 0 ? ` (+${stage.dcv} DCV)` : ""}.` });
    }

    await this.render(true);
  }

  async _openAddAdjustmentDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token || !isPrivileged()) return;

    const CHARS = ["STR","DEX","CON","INT","EGO","PRE","BODY","STUN","END","REC","SPD","PD","ED","OCV","DCV","OMCV","DMCV"];
    const charOptions = CHARS.map(c => `<option value="${c}">${c}</option>`).join("");

    const result = await new Promise(resolve => {
      new Dialog({
        title: `Add Drain / Aid — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Type:</label>
              <select id="adj-type" style="flex:1;">
                <option value="drain">Drain</option>
                <option value="aid">Aid</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Characteristic:</label>
              <select id="adj-char" style="flex:1;">${charOptions}</select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Points:</label>
              <input type="number" id="adj-points" value="6" min="1" style="width:70px;" autofocus/>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Fade rate:</label>
              <input type="number" id="adj-fade" value="5" min="1" style="width:70px;"/>
              <select id="adj-fade-interval" style="width:110px;">
                <option value="phase" selected>per Phase</option>
                <option value="segment">per Segment</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-check"></i>',
            label: "Add",
            callback: html => resolve({
              type:     html.find("#adj-type").val(),
              char:     html.find("#adj-char").val(),
              points:   parseInt(html.find("#adj-points").val()) || 1,
              fadeRate: parseInt(html.find("#adj-fade").val())   || 5,
              fadeInterval: normalizeFadeInterval(html.find("#adj-fade-interval").val())
            })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "apply"
      }).render(true);
    });

    if (!result) return;

    const existing = token.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type:     result.type,
      char:     result.char,
      points:   result.points,
      fadeRate: result.fadeRate,
      fadeInterval: result.fadeInterval
    };
    await token.document.setFlag("hero-combat-engine", "adjustments", [...existing, newEntry]);

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const typeLabel = result.type === "drain" ? "Drain" : "Aid";
    const fadeUnitLabel = result.fadeInterval === "segment" ? "Segment" : "Phase";
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong>: ${typeLabel} ${result.char} ${result.points} pts applied (fades ${result.fadeRate}/${fadeUnitLabel}).`
    });

    await this.render(true);
  }

  async _openAdjustmentDialog(tokenId, adjId) {
    const token = canvas.tokens.get(tokenId);
    if (!token || !isPrivileged()) return;

    const adjustments = token.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    const adj = adjustments.find(a => a.id === adjId);
    if (!adj) return;
    const adjFadeInterval = normalizeFadeInterval(adj.fadeInterval);
    const adjFadeUnitLabel = adjFadeInterval === "segment" ? "Segment" : "Phase";

    const typeLabel = adj.type === "drain" ? "Drain" : "Aid";

    const result = await new Promise(resolve => {
      new Dialog({
        title: `${typeLabel} ${adj.char} — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
              ${typeLabel} on <strong>${adj.char}</strong> — currently <strong>${adj.points} pts</strong> remaining (fades ${adj.fadeRate}/${adjFadeUnitLabel}).
            </p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Points remaining:</label>
              <input type="number" id="adj-points" value="${adj.points}" min="0" style="width:70px;" autofocus/>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Fade rate:</label>
              <input type="number" id="adj-fade" value="${adj.fadeRate}" min="1" style="width:70px;"/>
              <select id="adj-fade-interval" style="width:110px;">
                <option value="phase"${adjFadeInterval === "phase" ? " selected" : ""}>per Phase</option>
                <option value="segment"${adjFadeInterval === "segment" ? " selected" : ""}>per Segment</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          update: {
            icon: '<i class="fas fa-save"></i>',
            label: "Update",
            callback: html => resolve({
              action:   "update",
              points:   parseInt(html.find("#adj-points").val()) || 0,
              fadeRate: parseInt(html.find("#adj-fade").val())   || 5,
              fadeInterval: normalizeFadeInterval(html.find("#adj-fade-interval").val())
            })
          },
          remove: {
            icon: '<i class="fas fa-times"></i>',
            label: "Remove",
            callback: () => resolve({ action: "remove" })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "update"
      }).render(true);
    });

    if (!result) return;

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    if (result.action === "update") {
      if (result.points <= 0) {
        const newAdjs = adjustments.filter(a => a.id !== adjId);
        if (newAdjs.length) await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
        else await token.document.unsetFlag("hero-combat-engine", "adjustments");
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong>: ${typeLabel} ${adj.char} cleared manually.`
        });
      } else {
        const newAdjs = adjustments.map(a => a.id === adjId ? {
          ...a,
          points: result.points,
          fadeRate: result.fadeRate,
          fadeInterval: result.fadeInterval
        } : a);
        await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
        const fadeUnitLabel = result.fadeInterval === "segment" ? "Segment" : "Phase";
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong>: ${typeLabel} ${adj.char} updated — ${result.points} pts remaining (fades ${result.fadeRate}/${fadeUnitLabel}).`
        });
      }
    } else if (result.action === "remove") {
      const newAdjs = adjustments.filter(a => a.id !== adjId);
      if (newAdjs.length) await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
      else await token.document.unsetFlag("hero-combat-engine", "adjustments");
      ChatMessage.create({
        speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong>: ${typeLabel} ${adj.char} removed.`
      });
    }

    await this.render(true);
  }

  async _openEntangleDialog(tokenId, statusId = "restrain") {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token || !actor) return;
    if (!isPrivileged() && !actor.isOwner) return;

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const currentBody = token.document.getFlag("hero-combat-engine", "entangleBody") ?? 0;
    const clearStatusIds = (() => {
      const ids = new Set(getActiveEntangleStatusIds(actor));
      if (!ids.size && isEntangleStatus(statusId)) ids.add(statusId);
      return [...ids];
    })();

    const result = await new Promise(resolve => {
      new Dialog({
        title: `Entangle BODY — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
              Track remaining BODY for Entangle on <strong>${token.name}</strong>.
            </p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">BODY remaining:</label>
              <input type="number" id="ent-body" value="${currentBody}" min="0" style="width:70px;" autofocus/>
            </div>
          </div>
        `,
        buttons: {
          attack: {
            icon: '<i class="fas fa-sword"></i>',
            label: "Attack Entangle",
            callback: () => resolve({ action: "attack" })
          },
          update: {
            icon: '<i class="fas fa-save"></i>',
            label: "Update",
            callback: html => resolve({ action: "update", body: parseInt(html.find("#ent-body").val()) || 0 })
          },
          remove: {
            icon: '<i class="fas fa-times"></i>',
            label: "Remove Entangle",
            callback: () => resolve({ action: "remove" })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "update"
      }).render(true);
    });

    if (!result) return;

    if (result.action === "attack") {
      await this._openEntangleAttackDialog(tokenId, statusId);
      await this.render(true);
      return;
    }

    if (result.action === "update") {
      if (result.body <= 0) {
        await token.document.unsetFlag("hero-combat-engine", "entangleBody");
        for (const clearId of clearStatusIds) {
          const effectData = CONFIG.statusEffects?.find(e => e.id === clearId);
          if (!effectData) continue;
          const isEntangled = actor.statuses?.has(clearId) ?? actor.effects.some(e => [...(e.statuses ?? [])].includes(clearId));
          if (!isEntangled) continue;
          if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(clearId);
          else await token.toggleEffect(effectData);
        }
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Entangle removed.`
        });
      } else {
        await token.document.setFlag("hero-combat-engine", "entangleBody", result.body);
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Entangle BODY: ${result.body}.`
        });
      }
    } else if (result.action === "remove") {
      await token.document.unsetFlag("hero-combat-engine", "entangleBody");
      for (const clearId of clearStatusIds) {
        const effectData = CONFIG.statusEffects?.find(e => e.id === clearId);
        if (!effectData) continue;
        const isEntangled = actor.statuses?.has(clearId) ?? actor.effects.some(e => [...(e.statuses ?? [])].includes(clearId));
        if (!isEntangled) continue;
        if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(clearId);
        else await token.toggleEffect(effectData);
      }
      ChatMessage.create({
        speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> Entangle removed.`
      });
    }

    await this.render(true);
  }

  async _openEntangleAttackDialog(tokenId, statusId = "restrain") {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token || !actor) return;
    if (!isPrivileged() && !actor.isOwner) return;

    const currentBody = asNumber(token.document.getFlag("hero-combat-engine", "entangleBody"), 0);
    if (currentBody <= 0) {
      ui.notifications.warn(`${token.name} does not currently have Entangle BODY to attack.`);
      return;
    }

    const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const clearStatusIds = (() => {
      const ids = new Set(getActiveEntangleStatusIds(actor));
      if (!ids.size && isEntangleStatus(statusId)) ids.add(statusId);
      return [...ids];
    })();

    const options = getEntangleAttackOptions(actor);
    const optionMarkup = options.map((opt, idx) => {
      const modLabel = opt.ocvMod ? ` (OCV ${opt.ocvMod > 0 ? "+" : ""}${opt.ocvMod})` : "";
      const dmgLabel = opt.damageFormula ? ` [${opt.damageFormula}]` : "";
      return `<option value="${opt.id}"${idx === 0 ? " selected" : ""}>${opt.label}${modLabel}${dmgLabel}</option>`;
    }).join("");

    const attackSelection = await new Promise(resolve => {
      new Dialog({
        title: `Attack Entangle — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
              Choose an attack option, roll to hit Entangle, then apply BODY damage on a hit.
            </p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Attack option:</label>
              <select id="ent-attack-opt" style="flex:1;">${optionMarkup}</select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Target DCV:</label>
              <input type="number" id="ent-target-dcv" value="3" min="0" style="width:70px;"/>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Manual OCV mod:</label>
              <input type="number" id="ent-ocv-mod" value="0" style="width:70px;"/>
            </div>
          </div>
        `,
        buttons: {
          roll: {
            icon: '<i class="fas fa-dice"></i>',
            label: "Roll To Hit",
            callback: html => resolve({
              action: "roll",
              optionId: html.find("#ent-attack-opt").val(),
              targetDcv: parseInt(html.find("#ent-target-dcv").val()) || 0,
              manualOcvMod: parseInt(html.find("#ent-ocv-mod").val()) || 0
            })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "roll"
      }).render(true);
    });

    if (!attackSelection || attackSelection.action !== "roll") return;

    const chosen = options.find(o => o.id === attackSelection.optionId) ?? options[0];
    const baseOcv = asNumber(actor.system?.characteristics?.ocv?.value, 0);
    const totalOcv = baseOcv + asNumber(chosen.ocvMod, 0) + asNumber(attackSelection.manualOcvMod, 0);
    const targetNumber = 11 + totalOcv - asNumber(attackSelection.targetDcv, 0);
    const toHitRoll = await (new Roll("3d6")).evaluate({ async: true });
    const hit = toHitRoll.total <= targetNumber;

    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      roll: toHitRoll,
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> attacks Entangle with <strong>${chosen.label}</strong>: rolled <strong>${toHitRoll.total}</strong> vs target <strong>${targetNumber}</strong> (${hit ? "HIT" : "MISS"}).`
    });

    if (!hit) return;

    let suggestedDamage = "";
    let suggestedDefense = "0";
    let lastDamageRoll = null;

    while (true) {
      const damageResult = await new Promise(resolve => {
        new Dialog({
          title: `Apply Entangle Damage — ${token.name}`,
          content: `
            <div style="display:grid;gap:8px;margin-top:4px;">
              <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
                Enter BODY dealt to Entangle. Remaining BODY: <strong>${currentBody}</strong>.
              </p>
              <div style="display:flex;align-items:center;gap:8px;">
                <label style="min-width:130px;flex-shrink:0;">BODY damage:</label>
                <input type="number" id="ent-dmg" value="${suggestedDamage || "0"}" min="0" style="width:80px;" autofocus/>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <label style="min-width:130px;flex-shrink:0;">Defense applied:</label>
                <input type="number" id="ent-defense" value="${suggestedDefense}" min="0" style="width:80px;"/>
              </div>
              <p style="margin:0;font-size:0.8em;color:var(--color-text-dark-secondary);">Attack formula: ${chosen.damageFormula ? `<code>${chosen.damageFormula}</code>` : "none on selected attack"}${lastDamageRoll ? ` (last roll total ${lastDamageRoll.total})` : ""}</p>
            </div>
          `,
          buttons: {
            apply: {
              icon: '<i class="fas fa-check"></i>',
              label: "Apply Damage",
              callback: html => resolve({
                action: "apply",
                bodyDamage: parseInt(html.find("#ent-dmg").val()) || 0,
                defenseApplied: parseInt(html.find("#ent-defense").val()) || 0
              })
            },
            rollDamage: {
              icon: '<i class="fas fa-dice"></i>',
              label: "Roll Damage",
              callback: html => resolve({
                action: "rollDamage",
                defenseApplied: parseInt(html.find("#ent-defense").val()) || 0
              })
            },
            cancel: { label: "Cancel", callback: () => resolve(null) }
          },
          default: "apply"
        }).render(true);
      });

      if (!damageResult) return;

      suggestedDefense = String(Math.max(0, asNumber(damageResult.defenseApplied, 0)));

      if (damageResult.action === "rollDamage") {
        try {
          let formula = chosen.damageFormula;
          if (!formula) {
            const customFormula = await new Promise(resolve => {
              new Dialog({
                title: `Roll Damage Formula — ${token.name}`,
                content: `
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="min-width:120px;flex-shrink:0;">Damage formula:</label>
                    <input type="text" id="ent-dmg-formula" value="${suggestedDamage && /^\d+$/.test(suggestedDamage) ? `${suggestedDamage}` : "3d6"}" style="width:120px;" autofocus/>
                  </div>
                `,
                buttons: {
                  roll: { label: "Roll", callback: html => resolve(String(html.find("#ent-dmg-formula").val() ?? "").trim()) },
                  cancel: { label: "Cancel", callback: () => resolve(null) }
                },
                default: "roll"
              }).render(true);
            });
            if (!customFormula) continue;
            formula = customFormula;
          }

          lastDamageRoll = await (new Roll(formula)).evaluate({ async: true });
          suggestedDamage = String(lastDamageRoll.total ?? 0);
          ChatMessage.create({
            speaker: { alias: "Combat Engine" },
            roll: lastDamageRoll,
            content: `<strong>${token.name}</strong> damage roll for Entangle attack (${chosen.label}). Apply defense, then confirm net BODY in the dialog.`
          });
        } catch (err) {
          ui.notifications.error(`Invalid damage formula. Enter BODY manually or try another formula.`);
          console.error("[HERO ERROR] Entangle damage roll failed:", err);
        }
        continue;
      }

      if (damageResult.action !== "apply") return;

      const bodyDamage = Math.max(0, asNumber(damageResult.bodyDamage, 0));
      const defenseApplied = Math.max(0, asNumber(damageResult.defenseApplied, 0));
      const netBodyDamage = Math.max(0, bodyDamage - defenseApplied);
      const remaining = Math.max(0, currentBody - netBodyDamage);

      if (remaining <= 0) {
        await token.document.unsetFlag("hero-combat-engine", "entangleBody");
        for (const clearId of clearStatusIds) {
          const effectData = CONFIG.statusEffects?.find(e => e.id === clearId);
          if (!effectData) continue;
          const isEntangled = actor.statuses?.has(clearId) ?? actor.effects.some(e => [...(e.statuses ?? [])].includes(clearId));
          if (!isEntangled) continue;
          if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(clearId);
          else await token.toggleEffect(effectData);
        }
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> takes ${netBodyDamage} BODY to Entangle after ${defenseApplied} defense (${bodyDamage} rolled) and breaks free.`
        });
      } else {
        await token.document.setFlag("hero-combat-engine", "entangleBody", remaining);
        ChatMessage.create({
          speaker: { alias: "Combat Engine" },
          content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> takes ${netBodyDamage} BODY to Entangle after ${defenseApplied} defense (${bodyDamage} rolled). ${remaining} BODY remaining.`
        });
      }
      break;
    }
  }

  async _openCvAdjustmentDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token || !actor) return;
    if (!isPrivileged() && !actor.isOwner) return;

    const activeMods = token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
    const activeSummary = activeMods.length
      ? activeMods.map(m => {
        const parts = [];
        if (m.ocvMod) parts.push(`OCV ${m.ocvMod > 0 ? "+" : ""}${m.ocvMod}`);
        if (m.dcvMod) parts.push(`DCV ${m.dcvMod > 0 ? "+" : ""}${m.dcvMod}`);
        if (m.mcvMod) parts.push(`MCV ${m.mcvMod > 0 ? "+" : ""}${m.mcvMod}`);
        return `${parts.join(", ")} (${m.remainingSegments} segment${m.remainingSegments === 1 ? "" : "s"} left)`;
      }).join("<br>")
      : "None";

    const result = await new Promise(resolve => {
      new Dialog({
        title: `Temporary CV Modifiers — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
              Right-click CV controls. Apply temporary OCV/DCV/MCV changes for a fixed number of segments.
            </p>
            <div style="font-size:0.8em;padding:4px 6px;border:1px solid var(--color-border-light-secondary);border-radius:4px;">
              <strong>Active modifiers:</strong><br>${activeSummary}
            </div>

            <div style="display:grid;grid-template-columns:130px 1fr 42px;gap:6px 8px;align-items:center;">
              <label>OCV modifier:</label>
              <input type="range" id="cv-ocv" min="-10" max="10" step="1" value="0" oninput="this.nextElementSibling.textContent=this.value;"/>
              <span id="cv-ocv-val">0</span>

              <label>DCV modifier:</label>
              <input type="range" id="cv-dcv" min="-10" max="10" step="1" value="0" oninput="this.nextElementSibling.textContent=this.value;"/>
              <span id="cv-dcv-val">0</span>

              <label>MCV modifier:</label>
              <input type="range" id="cv-mcv" min="-10" max="10" step="1" value="0" oninput="this.nextElementSibling.textContent=this.value;"/>
              <span id="cv-mcv-val">0</span>
            </div>

            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Duration (segments):</label>
              <input type="number" id="cv-segments" min="1" value="1" style="width:72px;"/>
            </div>
          </div>
        `,
        buttons: Object.fromEntries(Object.entries({
          apply: {
            icon: '<i class="fas fa-check"></i>',
            label: "Apply",
            callback: html => resolve({
              action: "apply",
              ocvMod: parseInt(html.find("#cv-ocv").val()) || 0,
              dcvMod: parseInt(html.find("#cv-dcv").val()) || 0,
              mcvMod: parseInt(html.find("#cv-mcv").val()) || 0,
              segments: parseInt(html.find("#cv-segments").val()) || 1
            })
          },
          clear: activeMods.length ? {
            icon: '<i class="fas fa-trash"></i>',
            label: "Clear Active",
            callback: () => resolve({ action: "clear" })
          } : undefined,
          cancel: { label: "Cancel", callback: () => resolve(null) }
        }).filter(([_, v]) => v !== undefined)),
        default: "apply"
      }).render(true);
    });

    if (!result) return;

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    if (result.action === "clear") {
      const total = activeMods.reduce((acc, m) => {
        acc.ocv += m.ocvMod ?? 0;
        acc.dcv += m.dcvMod ?? 0;
        acc.mcv += m.mcvMod ?? 0;
        return acc;
      }, { ocv: 0, dcv: 0, mcv: 0 });

      const chars = actor.system?.characteristics ?? {};
      const updates = {};
      if (total.ocv) updates["system.characteristics.ocv.value"] = (chars.ocv?.value ?? 0) - total.ocv;
      if (total.dcv) updates["system.characteristics.dcv.value"] = (chars.dcv?.value ?? 0) - total.dcv;
      Object.assign(updates, getMCVUpdateData(actor, -total.mcv));

      if (Object.keys(updates).length) await actor.update(updates);
      await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");

      ChatMessage.create({
        speaker: { alias: "Combat Engine" },
        content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> CV modifiers cleared.`
      });

      await this.render(true);
      return;
    }

    const segments = Math.max(1, result.segments);
    if (!result.ocvMod && !result.dcvMod && !result.mcvMod) {
      ui.notifications.warn("Set at least one CV modifier (OCV, DCV, or MCV). ");
      return;
    }

    const chars = actor.system?.characteristics ?? {};
    const updates = {
      "system.characteristics.ocv.value": (chars.ocv?.value ?? 0) + result.ocvMod,
      "system.characteristics.dcv.value": (chars.dcv?.value ?? 0) + result.dcvMod,
      ...getMCVUpdateData(actor, result.mcvMod)
    };
    await actor.update(updates);

    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ocvMod: result.ocvMod,
      dcvMod: result.dcvMod,
      mcvMod: result.mcvMod,
      remainingSegments: segments
    };

    await token.document.setFlag("hero-combat-engine", "cvSegmentMods", [...activeMods, newEntry]);

    const parts = [];
    if (result.ocvMod) parts.push(`OCV ${result.ocvMod > 0 ? "+" : ""}${result.ocvMod}`);
    if (result.dcvMod) parts.push(`DCV ${result.dcvMod > 0 ? "+" : ""}${result.dcvMod}`);
    if (result.mcvMod) parts.push(`MCV ${result.mcvMod > 0 ? "+" : ""}${result.mcvMod}`);

    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> temporary CV mod applied: ${parts.join(", ")} for ${segments} segment${segments === 1 ? "" : "s"}.`
    });

    await this.render(true);
  }

  async _applyRecovery(tokenId) {
    if (!canvas?.scene) return;
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!actor) return;

    const chars = actor.system?.characteristics ?? {};
    const rec   = chars.rec?.value  ?? 0;
    const stun  = chars.stun?.value ?? 0;
    const stunMax = chars.stun?.max ?? stun;
    const end   = chars.end?.value  ?? 0;
    const endMax  = chars.end?.max  ?? end;

    const newStun = Math.min(stun + rec, stunMax);
    const newEnd  = Math.min(end  + rec, endMax);

    await actor.update({
      "system.characteristics.stun.value": newStun,
      "system.characteristics.end.value":  newEnd
    });

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    ChatMessage.create({
      speaker: { alias: "Combat Engine" },
      content: `<strong>Segment ${phase}.${segment}</strong><br><strong>${token.name}</strong> takes a Recovery.<br>STUN ${stun} → ${newStun} &nbsp;|&nbsp; END ${end} → ${newEnd}`
    });

    // Advance the turn after recovery
    if (game.heroCombat?.endTokenSegment) {
      await game.heroCombat.endTokenSegment(tokenId);
    }
  }

  async _removeToken(tokenId) {
    if (!canvas?.scene) return;
    const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
    if (!actingOrder.includes(tokenId)) return;

    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (token?.document && actor) {
      const activeMods = token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
      if (activeMods.length) {
        const total = activeMods.reduce((acc, m) => {
          acc.ocv += m.ocvMod ?? 0;
          acc.dcv += m.dcvMod ?? 0;
          acc.mcv += m.mcvMod ?? 0;
          return acc;
        }, { ocv: 0, dcv: 0, mcv: 0 });

        const chars = actor.system?.characteristics ?? {};
        const updates = {};
        if (total.ocv) updates["system.characteristics.ocv.value"] = (chars.ocv?.value ?? 0) - total.ocv;
        if (total.dcv) updates["system.characteristics.dcv.value"] = (chars.dcv?.value ?? 0) - total.dcv;
        Object.assign(updates, getMCVUpdateData(actor, -total.mcv));

        if (Object.keys(updates).length) await actor.update(updates);
        await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
      }
    }

    // If this token is currently acting, advance first so turn order stays valid
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const currentActingIndex = canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0;
    const actingThisSegment = getActingTokens(segment).map(t => t.id);
    const currentActingTokenId = actingThisSegment[currentActingIndex] ?? null;
    if (tokenId === currentActingTokenId && game.heroCombat?.nextActingToken) {
      await game.heroCombat.nextActingToken();
    }

    const newOrder = actingOrder.filter(id => id !== tokenId);
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.actingOrder", newOrder);

    // Prune ancillary state so stale entries don't persist
    const held = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
    if (held.includes(tokenId)) {
      await canvas.scene.setFlag("hero-combat-engine", "hero-combat.heldTokens", held.filter(id => id !== tokenId));
    }
    const aborted = canvas.scene.getFlag("hero-combat-engine", "hero-combat.abortedTokens") ?? [];
    if (aborted.includes(tokenId)) {
      await canvas.scene.setFlag("hero-combat-engine", "hero-combat.abortedTokens", aborted.filter(id => id !== tokenId));
    }
  }

  async _toggleHeld(tokenId) {
    if (!canvas?.scene) return;
    // Kept for backward-compat socket path — real logic is now in holdToken/releaseHold
    const held = canvas.scene.getFlag("hero-combat-engine", "hero-combat.heldTokens") ?? [];
    if (held.includes(tokenId)) {
      await game.heroCombat.releaseHold(tokenId);
    } else {
      await game.heroCombat.holdToken(tokenId);
    }
  }

  async _toggleAbort(tokenId) {
    if (!canvas?.scene) return;
    const aborted = canvas.scene.getFlag("hero-combat-engine", "hero-combat.abortedTokens") ?? [];
    const newAborted = aborted.includes(tokenId) ? aborted.filter(id => id !== tokenId) : [...aborted, tokenId];
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.abortedTokens", newAborted);
  }
}
