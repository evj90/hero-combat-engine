import { getActingTokens } from "./segment-engine.js";
import { combatEngineSpeaker } from "./utils.js";

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
  { dcv: 1, label: "Low" },
  { dcv: 2, label: "Medium" },
  { dcv: 3, label: "High" }
];

const OCV_STAGES = [
  { ocv: 0, label: "None" },
  { ocv: 1, label: "Low" },
  { ocv: 2, label: "Medium" },
  { ocv: 3, label: "High" }
];

const MCV_STAGES = [
  { mcv: 0, label: "None" },
  { mcv: 1, label: "Low" },
  { mcv: 2, label: "Medium" },
  { mcv: 3, label: "High" }
];

function getCoverStage(dcv) {
  return COVER_STAGES.find(s => s.dcv === dcv) ?? COVER_STAGES[0];
}

function getOcvStage(ocv) {
  return OCV_STAGES.find(s => s.ocv === ocv) ?? OCV_STAGES[0];
}

function getMcvStage(mcv) {
  return MCV_STAGES.find(s => s.mcv === mcv) ?? MCV_STAGES[0];
}

function normalizeFadeInterval(interval) {
  return interval === "segment" ? "segment" : "phase";
}

function normalizeAdjustmentCharKey(char) {
  return String(char ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function getAdjustmentBaseCharacteristicValue(actor, statKey) {
  if (statKey === "mcv") {
    const chars = actor.system?.characteristics ?? {};
    return Number(chars.mcv?.value ?? chars.dmcv?.value ?? chars.omcv?.value ?? 0);
  }
  return Number(actor.system?.characteristics?.[statKey]?.value ?? 0);
}

function getAdjustmentTargetDelta(baseValue, points, type) {
  const magnitude = Math.max(0, Number(points ?? 0));
  return type === "drain" ? -magnitude : magnitude;
}

function getAdjustmentUpdateData(actor, statKey, delta) {
  if (!delta) return {};
  if (statKey === "mcv") return getMCVUpdateData(actor, delta);
  const chars = actor.system?.characteristics ?? {};
  return {
    [`system.characteristics.${statKey}.value`]: (chars?.[statKey]?.value ?? 0) + delta
  };
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

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLightningReflexesIndicator(actor) {
  const lrItem = (actor?.items ?? []).find(item => {
    const haystacks = [
      item?.name,
      getNestedValue(item, "system.name"),
      getNestedValue(item, "system.effect"),
      getNestedValue(item, "system.description"),
      getNestedValue(item, "system.description.value"),
      getNestedValue(item, "system.notes"),
      getNestedValue(item, "system.summary")
    ]
      .map(value => String(value ?? ""))
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /lightning\s*reflex/i.test(haystacks);
  });

  if (!lrItem) return null;

  const detailCandidates = [
    getNestedValue(lrItem, "system.levels"),
    getNestedValue(lrItem, "system.amount"),
    getNestedValue(lrItem, "system.value"),
    getNestedValue(lrItem, "system.bonus"),
    getNestedValue(lrItem, "system.effect"),
    getNestedValue(lrItem, "system.summary"),
    getNestedValue(lrItem, "system.description"),
    getNestedValue(lrItem, "system.description.value"),
    getNestedValue(lrItem, "system.notes")
  ];

  const detail = detailCandidates
    .map(value => {
      if (value == null) return "";
      if (typeof value === "number") return `${value}`;
      if (typeof value === "string") return stripHtml(value);
      if (typeof value === "object") return stripHtml(value.value ?? value.label ?? value.name ?? "");
      return "";
    })
    .find(Boolean);

  const baseTooltip = detail
    ? `${lrItem.name}: ${detail}`
    : `${lrItem.name}${lrItem.type ? ` (${lrItem.type})` : ""}`;
  const tooltip = `Lightning Reflexes — ${baseTooltip}`;

  return {
    shortLabel: "LR",
    tooltip
  };
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

function normalizeCharacteristicKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function getCombatValueCharacteristics() {
  const raw = game.settings.get("hero-combat-engine", "combatValueCharacteristics") ?? "";
  if (!raw.trim()) {
    return ["ocv", "dcv", "mcv"];
  }

  const parsed = raw
    .split(/[,.\s;]+/)
    .map(normalizeCharacteristicKey)
    .filter(Boolean);

  const unique = [...new Set(parsed)];
  return unique.length ? unique : ["ocv", "dcv", "mcv"];
}

function getHideNonActingPreference() {
  const userValue = game.user?.getFlag("hero-combat-engine", "hideNonActing");
  if (typeof userValue === "boolean") return userValue;
  return game.settings.get("hero-combat-engine", "hideNonActing");
}

async function setHideNonActingPreference(value) {
  await game.user?.setFlag("hero-combat-engine", "hideNonActing", Boolean(value));
}

function getAbsoluteSegmentIndex(phase, segment) {
  const normalizedPhase = Math.max(1, Number(phase ?? 1));
  const normalizedSegment = Math.min(12, Math.max(1, Number(segment ?? 1)));
  return ((normalizedPhase - 1) * 12) + normalizedSegment;
}

function getCvModifierRemainingSegments(mod, currentPhase, currentSegment) {
  const expirePhase = Number(mod?.expirePhase);
  const expireSegment = Number(mod?.expireSegment);
  if (Number.isFinite(expirePhase) && Number.isFinite(expireSegment)) {
    const remaining = getAbsoluteSegmentIndex(expirePhase, expireSegment) - getAbsoluteSegmentIndex(currentPhase, currentSegment);
    return Math.max(0, remaining);
  }
  return Math.max(0, Number(mod?.remainingSegments ?? 0));
}

function createCvModifierEntry(statMods, segments, phase, segment) {
  const duration = Math.max(1, Number(segments ?? 1));
  const applyIndex = getAbsoluteSegmentIndex(phase, segment);
  const expireIndex = applyIndex + duration;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    statMods,
    remainingSegments: duration,
    appliedPhase: Number(phase ?? 1),
    appliedSegment: Number(segment ?? 1),
    expirePhase: Math.floor((expireIndex - 1) / 12) + 1,
    expireSegment: ((expireIndex - 1) % 12) + 1
  };
}

function getCharacteristicLabel(statKey) {
  return String(statKey ?? "").toUpperCase();
}

function getCharacteristicValue(actor, statKey) {
  const chars = actor?.system?.characteristics ?? {};
  if (statKey === "mcv") {
    return chars.mcv?.value ?? chars.dmcv?.value ?? chars.omcv?.value ?? 0;
  }
  return chars?.[statKey]?.value ?? 0;
}

function getCharacteristicUpdateData(actor, statKey, delta) {
  if (!delta) return {};
  if (statKey === "mcv") return getMCVUpdateData(actor, delta);

  const chars = actor.system?.characteristics ?? {};
  return {
    [`system.characteristics.${statKey}.value`]: (chars?.[statKey]?.value ?? 0) + delta
  };
}

function getCombatValueModsFromEntry(entry) {
  const statMods = {};

  if (entry?.statMods && typeof entry.statMods === "object") {
    for (const [key, value] of Object.entries(entry.statMods)) {
      const statKey = normalizeCharacteristicKey(key);
      const numeric = Number(value ?? 0);
      if (!statKey || !Number.isFinite(numeric) || numeric === 0) continue;
      statMods[statKey] = (statMods[statKey] ?? 0) + numeric;
    }
  }

  const legacyMap = {
    ocv: Number(entry?.ocvMod ?? 0),
    dcv: Number(entry?.dcvMod ?? 0),
    mcv: Number(entry?.mcvMod ?? 0)
  };
  for (const [statKey, numeric] of Object.entries(legacyMap)) {
    if (!Number.isFinite(numeric) || numeric === 0) continue;
    statMods[statKey] = (statMods[statKey] ?? 0) + numeric;
  }

  return statMods;
}

function sumCombatValueMods(entries) {
  const total = {};
  for (const entry of entries ?? []) {
    const statMods = getCombatValueModsFromEntry(entry);
    for (const [statKey, value] of Object.entries(statMods)) {
      total[statKey] = (total[statKey] ?? 0) + value;
    }
  }
  return total;
}

function formatCombatValueModParts(statMods, preferredOrder = []) {
  const keys = Object.keys(statMods ?? {}).filter(k => Number(statMods[k] ?? 0) !== 0);
  const order = [...preferredOrder.filter(k => keys.includes(k)), ...keys.filter(k => !preferredOrder.includes(k)).sort()];
  return order.map(statKey => {
    const delta = Number(statMods[statKey] ?? 0);
    return `${getCharacteristicLabel(statKey)} ${delta > 0 ? "+" : ""}${delta}`;
  });
}

function buildAdjustmentTooltip(adj) {
  const typeLabel = adj.type === "drain" ? "Drain" : "Aid";
  const fadeUnitLabel = normalizeFadeInterval(adj.fadeInterval) === "segment" ? "Seg" : "Ph";
  let tooltip = `${typeLabel} ${adj.char}: ${adj.points} pts (fades ${adj.fadeRate}/${fadeUnitLabel})`;
  
  if (adj.powerName) {
    tooltip += ` — ${adj.powerName}${adj.powerLevel ? ` L${adj.powerLevel}` : ""}`;
  }
  
  return tooltip;
}

function buildCombatValueTooltip(statKey, cvSegmentMods = [], phase, segment) {
  const currentIndex = getAbsoluteSegmentIndex(phase, segment);
  const applicableMods = [];
  
  for (const mod of cvSegmentMods) {
    const delta = Number(mod.statMods?.[statKey] ?? 0);
    if (delta === 0) continue;
    
    const modExpireIndex = mod.expirePhase ? getAbsoluteSegmentIndex(mod.expirePhase, mod.expireSegment) : currentIndex;
    const remaining = Math.max(0, modExpireIndex - currentIndex);
    
    if (remaining > 0) {
      const sign = delta > 0 ? "+" : "";
      const durationLabel = remaining === 1 ? "1 segment" : `${remaining} segments`;
      applicableMods.push(`${sign}${delta} (${durationLabel})`);
    }
  }
  
  if (applicableMods.length === 0) {
    return undefined;
  }
  
  return `Applied modifiers: ${applicableMods.join(", ")}`;
}

function getRevertDeltaMapForCvMods(activeMods = []) {
  const total = sumCombatValueMods(activeMods);
  const revertByStat = {};
  for (const [statKey, delta] of Object.entries(total)) {
    revertByStat[statKey] = (revertByStat[statKey] ?? 0) - Number(delta ?? 0);
  }
  return revertByStat;
}

function getRevertDeltaMapForAdjustments(adjustments = []) {
  const total = {};
  for (const adj of adjustments) {
    const statKey = normalizeAdjustmentCharKey(adj.charKey ?? adj.char);
    const applied = Number(adj.appliedDelta ?? 0);
    if (!statKey || !applied) continue;
    total[statKey] = (total[statKey] ?? 0) - applied;
  }
  return total;
}

function getRevertUpdatesForBonusFlags(actor, tokenDocument) {
  const updates = {};

  const cover = Number(tokenDocument?.getFlag("hero-combat-engine", "coverDCV") ?? 0);
  if (cover) {
    updates["system.characteristics.dcv.value"] = (actor.system?.characteristics?.dcv?.value ?? 0) - cover;
  }

  const ocvBonus = Number(tokenDocument?.getFlag("hero-combat-engine", "ocvBonus") ?? 0);
  if (ocvBonus) {
    updates["system.characteristics.ocv.value"] = (actor.system?.characteristics?.ocv?.value ?? 0) - ocvBonus;
  }

  const mcvBonus = Number(tokenDocument?.getFlag("hero-combat-engine", "mcvBonus") ?? 0);
  if (mcvBonus) {
    Object.assign(updates, getMCVUpdateData(actor, -mcvBonus));
  }

  return updates;
}

function pipsArray(label) {
  const n = BUCKET_PIPS[label] ?? 0;
  return Array.from({ length: 5 }, (_, i) => i < n);
}

// Returns true for GameMaster, Assistant GM, and Trusted players.
function isPrivileged() {
  return game.user.isGM || game.user.role >= CONST.USER_ROLES.TRUSTED;
}

function canDirectlyUpdateScene() {
  return game.user.isGM;
}

function emitCombatSocket(type, data = {}) {
  game.socket.emit("module.hero-combat-engine", { type, userId: game.user.id, ...data });
}

function createCombatChatMessage(content, phase, segment, extraData = {}) {
  return ChatMessage.create({
    ...extraData,
    speaker: combatEngineSpeaker(phase, segment),
    content
  });
}

function isDisabledControl(element) {
  return element?.classList?.contains("disabled")
    || element?.classList?.contains("read-only")
    || element?.getAttribute?.("aria-disabled") === "true";
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
    const privilegedUser = isPrivileged();
    const settingSize = game.settings.get("hero-combat-engine", "accessibilitySize") ?? "compact";
    const legacyExpanded = game.settings.get("hero-combat-engine", "expandedAccessibility") ?? false;
    const accessibilitySize = ["compact", "medium", "large"].includes(settingSize)
      ? settingSize
      : (legacyExpanded ? "medium" : "compact");
    const accessibilityClass = accessibilitySize === "compact" ? "" : ` a11y-${accessibilitySize}`;

    if (!canvas?.scene) return {
      phase: 1, segment: 1, isGM: privilegedUser,
      canManageCombat: false,
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
    const combatValueCharacteristics = getCombatValueCharacteristics();
    const playerSelfAdvance = game.settings.get("hero-combat-engine", "playerSelfAdvance");
    const hideNonActing = getHideNonActingPreference();

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
    const currentActingToken = currentActingTokenId ? canvas.tokens.get(currentActingTokenId) : null;
    const currentActingTokenName = currentActingToken?.name ?? null;
    const alreadyActedIds = new Set(actingThisSegment.slice(0, currentActingIndex));

    const allCombatants = actingOrder.map(tokenId => {
      const token = canvas.tokens.get(tokenId);
      const actor = token?.actor;
      if (!token || !actor) return null;

      const spd = actor.system?.characteristics?.spd?.value ?? 0;
      const canActThisSegment = (game.heroCombat?.SPD_MAP?.[spd] ?? []).includes(segment);
      const isActing = token.id === currentActingTokenId;
      const hasActed = alreadyActedIds.has(token.id);

      const ownerIds = Object.entries(actor.ownership ?? {})
        .filter(([id, perm]) => id !== "default" && perm >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        .map(([id]) => id);
      const isOwnedByCurrentUser = ownerIds.includes(game.user.id);
      const canControlToken = privilegedUser || isOwnedByCurrentUser;
      const canSelfAdvanceTurn = privilegedUser || playerSelfAdvance || isOwnedByCurrentUser;
      const allowEndTurn = isActing && canSelfAdvanceTurn;
      const allowRemove = canControlToken;
      const canSeeStats = canControlToken;
      const isHeld    = heldTokenIds.has(token.id);
      const isAborted = abortedTokenIds.has(token.id);
      const showHold = canActThisSegment && !hasActed && !isHeld;
      const allowHold = showHold && canControlToken;
      const showRelease = isHeld;
      const allowRelease = showRelease && canControlToken;
      const showAbort = canActThisSegment && !hasActed && !isActing;
      const allowAbort = showAbort && canControlToken;
      const showEndTurn = isActing;
      const canManageTurnEffects = canControlToken;
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
      const ocvBonus = token.document.getFlag("hero-combat-engine", "ocvBonus") ?? 0;
      const ocvStage = getOcvStage(ocvBonus);
      const mcvBonus = token.document.getFlag("hero-combat-engine", "mcvBonus") ?? 0;
      const mcvStage = getMcvStage(mcvBonus);
      const cvSegmentMods = token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
      const cvMods = sumCombatValueMods(cvSegmentMods);
      const lightningReflexes = getLightningReflexesIndicator(actor);
      const combatValueRows = combatValueCharacteristics.map(statKey => {
        const tempDelta = Number(cvMods[statKey] ?? 0);
        return {
          key: statKey,
          label: getCharacteristicLabel(statKey),
          value: getCharacteristicValue(actor, statKey),
          tempClass: tempDelta > 0 ? "temp-buff" : (tempDelta < 0 ? "temp-debuff" : ""),
          tooltip: buildCombatValueTooltip(statKey, cvSegmentMods, phase, segment)
        };
      });

      return {
        id: token.id,
        name: token.name,
        img: token.document.texture?.src || actor.img || "icons/svg/mystery-man.svg",
        spd,
        combatValueRows,
        statBars,
        canSeeStats,
        effects,
        adjustments: (token.document.getFlag("hero-combat-engine", "adjustments") ?? []).map(a => {
          const fadeInterval = normalizeFadeInterval(a.fadeInterval);
          return {
            ...a,
            fadeInterval,
            fadeUnitLabel: fadeInterval === "segment" ? "Segment" : "Phase",
            isDrain: a.type === "drain",
            canManage: canManageTurnEffects,
            tooltip: buildAdjustmentTooltip(a)
          };
        }),
        isGM: privilegedUser,
        isActing, isHeld, isAborted,
        showHold, showRelease, showAbort, showEndTurn,
        allowEndTurn, allowRemove, allowHold, allowRelease, allowAbort,
        canManageTurnEffects,
        canActThisSegment,
        stateClass,
        statusText,
        lightningReflexes,
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
              showInTracker: s.id !== "prone",
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
        ocvBonus,
        ocvStageLabel: ocvStage.label,
        mcvBonus,
        mcvStageLabel: mcvStage.label,
        entangleBody: token.document.getFlag("hero-combat-engine", "entangleBody") ?? 0,
        canToggleCover: canControlToken,
        canToggleOcvBonus: canControlToken,
        canToggleMcvBonus: canControlToken,
        canManageCv: canControlToken
      };
    }).filter(Boolean);
    const combatants = allCombatants.filter(c => !hideNonActing || c.canActThisSegment);

    return {
      phase,
      segment,
      isGM: privilegedUser,
      canManageCombat: privilegedUser,
      accessibilityClass,
      showSpdColumn,
      hideNonActing,
      actingSPDs,
      combatants,
      hasCombatants: allCombatants.length > 0,
      currentActingTokenId,
      currentActingTokenName,
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

    html.find(".token-image").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.closest('[data-token-id]').dataset.tokenId;
      if (canDirectlyUpdateScene()) {
        await this._insertTokenAtFront(tokenId);
      } else {
        emitCombatSocket("my-turn", { tokenId });
      }
    });

    html.find(".hero-end-segment").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.endTokenSegment) {
            await game.heroCombat.endTokenSegment(tokenId);
          }
        } else {
          emitCombatSocket("end-turn", { tokenId });
        }
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] endTokenSegment failed:", err);
      }
    });

    html.find("#hero-prev-segment").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.previousSegment) await game.heroCombat.previousSegment();
        } else {
          emitCombatSocket("previous-segment");
        }
      } catch (err) {
        console.error("[HERO ERROR] previousSegment failed:", err);
      }
    });

    html.find("#hero-next-segment").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.segmentAdvance) await game.heroCombat.segmentAdvance();
        } else {
          emitCombatSocket("next-segment");
        }
      } catch (err) {
        console.error("[HERO ERROR] segmentAdvance failed:", err);
      }
    });

    html.find("#hero-prev-token").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.previousActingToken) await game.heroCombat.previousActingToken();
        } else {
          emitCombatSocket("previous-token");
        }
      } catch (err) {
        console.error("[HERO ERROR] previousActingToken failed:", err);
      }
    });

    html.find("#hero-next-token").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.nextActingToken) await game.heroCombat.nextActingToken();
        } else {
          emitCombatSocket("next-token");
        }
      } catch (err) {
        console.error("[HERO ERROR] nextActingToken failed:", err);
      }
    });

    html.find("#hero-begin-combat").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.beginCombat) await game.heroCombat.beginCombat();
        } else {
          const tokenIds = canvas.tokens.controlled.map(token => token.id);
          if (!tokenIds.length) {
            ui.notifications.warn("Select at least one token to begin combat.");
            return;
          }
          emitCombatSocket("begin-combat", { tokenIds });
        }
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] beginCombat failed:", err);
      }
    });

    html.find("#hero-add-selected").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.addSelectedTokens) await game.heroCombat.addSelectedTokens();
        } else {
          const tokenIds = canvas.tokens.controlled.map(token => token.id);
          if (!tokenIds.length) {
            ui.notifications.warn("Select at least one token to add to combat.");
            return;
          }
          emitCombatSocket("add-selected", { tokenIds });
        }
        await this.render(true);
      } catch (err) {
        console.error("[HERO ERROR] addSelectedTokens failed:", err);
      }
    });

    html.find("#hero-remove-selected").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
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
      if (canDirectlyUpdateScene()) {
        for (const token of selected) {
          await this._removeToken(token.id);
        }
      } else {
        emitCombatSocket("remove-combatants", { tokenIds: selected.map(token => token.id) });
      }
      await this.render(true);
    });

    html.find("#hero-highlight").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.highlightActing) await game.heroCombat.highlightActing();
        } else {
          emitCombatSocket("highlight-acting");
        }
      } catch (err) {
        console.error("[HERO ERROR] highlightActing failed:", err);
      }
    });

    html.find("#hero-toggle-hide-non-acting").click(async (e) => {
      e.preventDefault();
      const current = getHideNonActingPreference();
      await setHideNonActingPreference(!current);
      await this.render(true);
    });

    html.find("#hero-end-combat").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.endCombat) await game.heroCombat.endCombat();
        } else {
          emitCombatSocket("end-combat");
        }
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
      // Bypass Foundry's PING_CANVAS permission check so any player can ping from the combat panel
      const point = token.center;
      const style = CONFIG.Canvas.pings.types.PULSE;
      game.user.broadcastActivity({
        ping: { point, style, scene: canvas.scene?.id, zoom: true, pull: false }
      });
      if (typeof canvas._onPing === "function") canvas._onPing(point, style);
    });

    html.find(".hero-pan-token").click((e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token) return;
      canvas.animatePan({ x: token.center.x, y: token.center.y, scale: Math.max(1, canvas.stage.scale.x), duration: 250 });
    });

    html.find(".hero-acting-label").dblclick((e) => {
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token) return;
      canvas.animatePan({ x: token.center.x, y: token.center.y, scale: Math.max(1, canvas.stage.scale.x), duration: 250 });
    });

    html.find(".hero-remove-combatant").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const confirmed = await Dialog.confirm({
        title: "Remove from Combat",
        content: `<p>Remove this token from the combat order?</p>`
      });
      if (!confirmed) return;
      if (canDirectlyUpdateScene()) {
        await this._removeToken(tokenId);
      } else {
        emitCombatSocket("remove-combatant", { tokenId });
      }
    });

    html.find(".hero-take-recovery").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (canDirectlyUpdateScene()) {
        await this._applyRecovery(tokenId);
      } else {
        emitCombatSocket("take-recovery", { tokenId });
      }
    });

    html.find("#hero-refresh-order").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      try {
        if (canDirectlyUpdateScene()) {
          if (game.heroCombat?.refreshCombatOrder) await game.heroCombat.refreshCombatOrder();
        } else {
          emitCombatSocket("refresh-order");
        }
      } catch (err) {
        console.error("[HERO ERROR] refreshCombatOrder failed:", err);
      }
    });

    html.find(".hero-hold-token").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (canDirectlyUpdateScene()) {
        await game.heroCombat.holdToken(tokenId);
      } else {
        emitCombatSocket("hold-token", { tokenId });
      }
    });

    html.find(".hero-release-hold").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (canDirectlyUpdateScene()) {
        await game.heroCombat.releaseHold(tokenId);
      } else {
        emitCombatSocket("release-hold", { tokenId });
      }
    });

    html.find(".hero-abort-token").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      if (canDirectlyUpdateScene()) {
        await this._toggleAbort(tokenId);
      } else {
        emitCombatSocket("toggle-abort", { tokenId });
      }
    });

    html.find(".hero-status-btn.active").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId  = e.currentTarget.dataset.tokenId;
      const statusId = e.currentTarget.dataset.statusId;
      await this._openStatusTrackerDialog(tokenId, statusId);
    });

    html.find(".hero-adjustment-badge").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const adjId   = e.currentTarget.dataset.adjId;
      await this._openAdjustmentDialog(tokenId, adjId);
    });

    html.find(".hero-add-adjustment").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      await this._openAddAdjustmentDialog(tokenId);
    });

    html.find(".hero-entangle-badge").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      await this._openEntangleDialog(tokenId, getPreferredEntangleStatusId(token?.actor));
    });

    // Use native addEventListener so the contextmenu event reaches us regardless
    // of any jQuery-layer interception that was swallowing it previously.
    html.find(".hero-cv-stack").each((_, el) => {
      el.addEventListener("contextmenu", async (e) => {
        if (isDisabledControl(el)) return;
        e.preventDefault();
        e.stopPropagation();
        await this._openCvAdjustmentDialog(el.dataset.tokenId);
      });
    });

    html.find(".hero-cover-btn:not(.hero-ocv-btn):not(.hero-mcv-btn)").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
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
      createCombatChatMessage(`<strong>${token.name}</strong> cover: ${nextStage.label}${nextStage.dcv > 0 ? ` (+${nextStage.dcv} DCV)` : ""}.`, phase, segment);

      await this.render(true);
    });

    html.find(".hero-ocv-btn").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      const current = token.document.getFlag("hero-combat-engine", "ocvBonus") ?? 0;
      const currentIdx = OCV_STAGES.findIndex(s => s.ocv === current);
      const nextStage = OCV_STAGES[(currentIdx + 1) % OCV_STAGES.length];
      const actorOcv = token.actor.system?.characteristics?.ocv?.value ?? 0;

      await token.actor.update({ "system.characteristics.ocv.value": actorOcv - current + nextStage.ocv });

      if (nextStage.ocv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "ocvBonus");
      } else {
        await token.document.setFlag("hero-combat-engine", "ocvBonus", nextStage.ocv);
      }

      const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
      const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
      createCombatChatMessage(`<strong>${token.name}</strong> OCV bonus: ${nextStage.label}${nextStage.ocv > 0 ? ` (+${nextStage.ocv} OCV)` : ""}.`, phase, segment);

      await this.render(true);
    });

    html.find(".hero-mcv-btn").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      const current = token.document.getFlag("hero-combat-engine", "mcvBonus") ?? 0;
      const currentIdx = MCV_STAGES.findIndex(s => s.mcv === current);
      const nextStage = MCV_STAGES[(currentIdx + 1) % MCV_STAGES.length];

      await token.actor.update(getMCVUpdateData(token.actor, nextStage.mcv - current));

      if (nextStage.mcv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "mcvBonus");
      } else {
        await token.document.setFlag("hero-combat-engine", "mcvBonus", nextStage.mcv);
      }

      const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
      const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
      createCombatChatMessage(`<strong>${token.name}</strong> MCV bonus: ${nextStage.label}${nextStage.mcv > 0 ? ` (+${nextStage.mcv} MCV)` : ""}.`, phase, segment);

      await this.render(true);
    });

    html.find(".hero-cover-btn:not(.hero-ocv-btn):not(.hero-mcv-btn)").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      await this._openCoverDialog(tokenId);
    });

    html.find(".hero-ocv-btn").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      await this._openOcvBonusDialog(tokenId);
    });

    html.find(".hero-mcv-btn").on("contextmenu", async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
      e.preventDefault();
      const tokenId = e.currentTarget.dataset.tokenId;
      const token = canvas.tokens.get(tokenId);
      if (!token?.actor) return;
      if (!isPrivileged() && !token.actor.isOwner) return;
      await this._openMcvBonusDialog(tokenId);
    });

    html.find(".hero-status-btn").click(async (e) => {
      if (isDisabledControl(e.currentTarget)) return;
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
          createCombatChatMessage(`<strong>${token.name}</strong> Flash (${senseName}) cleared manually.`, phase, segment);
          // Remove the status effect
          const effectData = CONFIG.statusEffects?.find(e => e.id === statusId);
          if (effectData) {
            if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(statusId);
            else await token.toggleEffect(effectData);
          }
        } else {
          const fd = actor.system?.characteristics?.fd?.value ?? 0;
          await token.document.setFlag("hero-combat-engine", flagKey, result.fp);
          createCombatChatMessage(`<strong>${token.name}</strong> Flash (${senseName}): ${result.fp} FP remaining (FD ${fd}, recovers 1/segment).`, phase, segment);
        }
      } else if (result.action === "remove") {
        await token.document.unsetFlag("hero-combat-engine", flagKey);
        const effectData = CONFIG.statusEffects?.find(e => e.id === statusId);
        if (effectData) {
          if (typeof actor.toggleStatusEffect === "function") await actor.toggleStatusEffect(statusId);
          else await token.toggleEffect(effectData);
        }
        createCombatChatMessage(`<strong>${token.name}</strong> Flash (${senseName}) removed.`, phase, segment);
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
      createCombatChatMessage(`<strong>${token.name}</strong> recovers from Stun.`, phase, segment);
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
    createCombatChatMessage(`<strong>${token.name}</strong>: ${statusMeta?.label?.split("—")[0]?.trim() ?? statusId} removed.`, phase, segment);
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
              <select id="dcv-bonus" style="flex:1;">
                <option value="0"${current === 0 ? " selected" : ""}>+0 DCV</option>
                <option value="1"${current === 1 ? " selected" : ""}>+1 DCV</option>
                <option value="2"${current === 2 ? " selected" : ""}>+2 DCV</option>
                <option value="3"${current === 3 ? " selected" : ""}>+3 DCV</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-shield-halved"></i>',
            label: current > 0 ? "Update" : "Apply",
            callback: html => resolve({ action: "apply", dcv: parseInt(html.find("#dcv-bonus").val()) })
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
      createCombatChatMessage(`<strong>${token.name}</strong> cover: ${stage.label}${stage.dcv > 0 ? ` (+${stage.dcv} DCV)` : ""}.`, phase, segment);
    }

    await this.render(true);
  }

  async _openOcvBonusDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return;
    const current = token.document.getFlag("hero-combat-engine", "ocvBonus") ?? 0;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    const result = await new Promise(resolve => {
      new Dialog({
        title: `OCV Bonus — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">Select the temporary OCV bonus.</p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:100px;flex-shrink:0;">OCV bonus:</label>
              <select id="ocv-bonus" style="flex:1;">
                <option value="0"${current === 0 ? " selected" : ""}>+0 OCV</option>
                <option value="1"${current === 1 ? " selected" : ""}>+1 OCV</option>
                <option value="2"${current === 2 ? " selected" : ""}>+2 OCV</option>
                <option value="3"${current === 3 ? " selected" : ""}>+3 OCV</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-crosshairs"></i>',
            label: current > 0 ? "Update" : "Apply",
            callback: html => resolve({ action: "apply", ocv: parseInt(html.find("#ocv-bonus").val()) })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "apply"
      }).render(true);
    });

    if (!result) return;

    const actorOcv = token.actor.system?.characteristics?.ocv?.value ?? 0;

    if (result.action === "apply") {
      const adjustedOcv = actorOcv - current + result.ocv;
      await token.actor.update({ "system.characteristics.ocv.value": adjustedOcv });
      if (result.ocv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "ocvBonus");
      } else {
        await token.document.setFlag("hero-combat-engine", "ocvBonus", result.ocv);
      }
      const stage = getOcvStage(result.ocv);
      createCombatChatMessage(`<strong>${token.name}</strong> OCV bonus: ${stage.label}${stage.ocv > 0 ? ` (+${stage.ocv} OCV)` : ""}.`, phase, segment);
    }

    await this.render(true);
  }

  async _openMcvBonusDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return;
    const current = token.document.getFlag("hero-combat-engine", "mcvBonus") ?? 0;
    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    const result = await new Promise(resolve => {
      new Dialog({
        title: `MCV Bonus — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">Select the temporary MCV bonus.</p>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:100px;flex-shrink:0;">MCV bonus:</label>
              <select id="mcv-bonus" style="flex:1;">
                <option value="0"${current === 0 ? " selected" : ""}>+0 MCV</option>
                <option value="1"${current === 1 ? " selected" : ""}>+1 MCV</option>
                <option value="2"${current === 2 ? " selected" : ""}>+2 MCV</option>
                <option value="3"${current === 3 ? " selected" : ""}>+3 MCV</option>
              </select>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-brain"></i>',
            label: current > 0 ? "Update" : "Apply",
            callback: html => resolve({ action: "apply", mcv: parseInt(html.find("#mcv-bonus").val()) })
          },
          cancel: { label: "Cancel", callback: () => resolve(null) }
        },
        default: "apply"
      }).render(true);
    });

    if (!result) return;

    if (result.action === "apply") {
      await token.actor.update(getMCVUpdateData(token.actor, result.mcv - current));
      if (result.mcv === 0) {
        await token.document.unsetFlag("hero-combat-engine", "mcvBonus");
      } else {
        await token.document.setFlag("hero-combat-engine", "mcvBonus", result.mcv);
      }
      const stage = getMcvStage(result.mcv);
      createCombatChatMessage(`<strong>${token.name}</strong> MCV bonus: ${stage.label}${stage.mcv > 0 ? ` (+${stage.mcv} MCV)` : ""}.`, phase, segment);
    }

    await this.render(true);
  }

  async _openAddAdjustmentDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return;
    if (!isPrivileged() && !token.actor.isOwner) return;

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
              <label style="min-width:130px;flex-shrink:0;">Power Name:</label>
              <input type="text" id="adj-power-name" placeholder="e.g., Telepathy, Drain STR" style="flex:1;" autofocus/>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Power Level:</label>
              <input type="number" id="adj-power-level" placeholder="e.g., 10" min="0" style="width:70px;"/>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Characteristic:</label>
              <select id="adj-char" style="flex:1;">${charOptions}</select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Points:</label>
              <input type="number" id="adj-points" value="6" min="1" style="width:70px;"/>
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
              powerName: String(html.find("#adj-power-name").val() ?? "").trim(),
              powerLevel: parseInt(html.find("#adj-power-level").val()) || 0,
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

    const statKey = normalizeAdjustmentCharKey(result.char);
    const baseValue = getAdjustmentBaseCharacteristicValue(token.actor, statKey);
    const appliedDelta = getAdjustmentTargetDelta(baseValue, result.points, result.type);

    if (appliedDelta !== 0) {
      await token.actor.update(getAdjustmentUpdateData(token.actor, statKey, appliedDelta));
    }

    const existing = token.document.getFlag("hero-combat-engine", "adjustments") ?? [];
    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type:     result.type,
      powerName: result.powerName,
      powerLevel: result.powerLevel,
      char:     result.char,
      charKey:  statKey,
      points:   result.points,
      fadeRate: result.fadeRate,
      fadeInterval: result.fadeInterval,
      baseValue,
      appliedDelta
    };
    await token.document.setFlag("hero-combat-engine", "adjustments", [...existing, newEntry]);

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const typeLabel = result.type === "drain" ? "Drain" : "Aid";
    const fadeUnitLabel = result.fadeInterval === "segment" ? "Segment" : "Phase";
    const powerInfo = result.powerName ? ` (${result.powerName}${result.powerLevel ? " L" + result.powerLevel : ""})` : "";
    createCombatChatMessage(`<strong>${token.name}</strong>: ${typeLabel} ${result.char} ${result.points} pts applied${powerInfo} (fades ${result.fadeRate}/${fadeUnitLabel}).`, phase, segment);

    await this.render(true);
  }

  async _openAdjustmentDialog(tokenId, adjId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return;
    if (!isPrivileged() && !token.actor.isOwner) return;

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
        if (adj.appliedDelta) {
          const statKey = normalizeAdjustmentCharKey(adj.charKey ?? adj.char);
          await token.actor.update(getAdjustmentUpdateData(token.actor, statKey, -Number(adj.appliedDelta || 0)));
        }
        const newAdjs = adjustments.filter(a => a.id !== adjId);
        if (newAdjs.length) await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
        else await token.document.unsetFlag("hero-combat-engine", "adjustments");
        createCombatChatMessage(`<strong>${token.name}</strong>: ${typeLabel} ${adj.char} cleared manually.`, phase, segment);
      } else {
        const statKey = normalizeAdjustmentCharKey(adj.charKey ?? adj.char);
        const baseValue = Number(adj.baseValue ?? getAdjustmentBaseCharacteristicValue(token.actor, statKey));
        const oldApplied = Number(adj.appliedDelta ?? 0);
        const nextApplied = getAdjustmentTargetDelta(baseValue, result.points, adj.type);
        const delta = nextApplied - oldApplied;
        if (delta !== 0) {
          await token.actor.update(getAdjustmentUpdateData(token.actor, statKey, delta));
        }

        const newAdjs = adjustments.map(a => a.id === adjId ? {
          ...a,
          points: result.points,
          fadeRate: result.fadeRate,
          fadeInterval: result.fadeInterval,
          charKey: statKey,
          baseValue,
          appliedDelta: nextApplied
        } : a);
        await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
        const fadeUnitLabel = result.fadeInterval === "segment" ? "Segment" : "Phase";
        createCombatChatMessage(`<strong>${token.name}</strong>: ${typeLabel} ${adj.char} updated — ${result.points} pts remaining (fades ${result.fadeRate}/${fadeUnitLabel}).`, phase, segment);
      }
    } else if (result.action === "remove") {
      if (adj.appliedDelta) {
        const statKey = normalizeAdjustmentCharKey(adj.charKey ?? adj.char);
        await token.actor.update(getAdjustmentUpdateData(token.actor, statKey, -Number(adj.appliedDelta || 0)));
      }
      const newAdjs = adjustments.filter(a => a.id !== adjId);
      if (newAdjs.length) await token.document.setFlag("hero-combat-engine", "adjustments", newAdjs);
      else await token.document.unsetFlag("hero-combat-engine", "adjustments");
      createCombatChatMessage(`<strong>${token.name}</strong>: ${typeLabel} ${adj.char} removed.`, phase, segment);
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
        createCombatChatMessage(`<strong>${token.name}</strong> Entangle removed.`, phase, segment);
      } else {
        await token.document.setFlag("hero-combat-engine", "entangleBody", result.body);
        createCombatChatMessage(`<strong>${token.name}</strong> Entangle BODY: ${result.body}.`, phase, segment);
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
      createCombatChatMessage(`<strong>${token.name}</strong> Entangle removed.`, phase, segment);
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

    createCombatChatMessage(
      `<strong>${token.name}</strong> attacks Entangle with <strong>${chosen.label}</strong>: rolled <strong>${toHitRoll.total}</strong> vs target <strong>${targetNumber}</strong> (${hit ? "HIT" : "MISS"}).`,
      phase,
      segment,
      { roll: toHitRoll }
    );

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
          createCombatChatMessage(
            `<strong>${token.name}</strong> damage roll for Entangle attack (${chosen.label}). Apply defense, then confirm net BODY in the dialog.`,
            phase,
            segment,
            { roll: lastDamageRoll }
          );
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
          createCombatChatMessage(`<strong>${token.name}</strong> takes ${netBodyDamage} BODY to Entangle after ${defenseApplied} defense (${bodyDamage} rolled) and breaks free.`, phase, segment);
      } else {
        await token.document.setFlag("hero-combat-engine", "entangleBody", remaining);
          createCombatChatMessage(`<strong>${token.name}</strong> takes ${netBodyDamage} BODY to Entangle after ${defenseApplied} defense (${bodyDamage} rolled). ${remaining} BODY remaining.`, phase, segment);
      }
      break;
    }
  }

  async _openCvAdjustmentDialog(tokenId) {
    const token = canvas.tokens.get(tokenId);
    const actor = token?.actor;
    if (!token || !actor) return;
    if (!isPrivileged() && !actor.isOwner) return;

    const configuredStats = getCombatValueCharacteristics();
    const activeMods = token.document.getFlag("hero-combat-engine", "cvSegmentMods") ?? [];
    const currentPhase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
    const currentSegment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    // Build per-modifier rows with explicit duration and cancel controls.
    const activeModRows = activeMods.map((m, idx) => {
      const parts = formatCombatValueModParts(getCombatValueModsFromEntry(m), configuredStats);
      const remainingSegments = getCvModifierRemainingSegments(m, currentPhase, currentSegment);
      const appliedPhase = Number(m.appliedPhase);
      const appliedSegment = Number(m.appliedSegment);
      const appliedLabel = Number.isFinite(appliedPhase) && Number.isFinite(appliedSegment)
        ? `${appliedPhase}.${appliedSegment}`
        : "-";
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 110px 88px 64px;gap:8px;align-items:center;padding:4px 0;border-top:1px solid var(--color-border-light-tertiary);">
        <span style="min-width:0;overflow-wrap:anywhere;">${parts.join(", ")}</span>
        <span>${remainingSegments} seg${remainingSegments === 1 ? "" : "s"} left</span>
        <span style="color:var(--color-text-dark-secondary);font-size:0.85em;">Applied ${appliedLabel}</span>
        <span style="display:flex;justify-content:flex-end;gap:4px;">
          <button type="button" class="cv-mod-edit" data-mod-index="${idx}" title="Edit this modifier" style="flex-shrink:0;width:24px;height:24px;padding:0;line-height:24px;text-align:center;"><i class="fas fa-pen-to-square"></i></button>
          <button type="button" class="cv-mod-remove" data-mod-index="${idx}" title="Cancel this modifier" style="flex-shrink:0;padding:1px 8px;line-height:20px;text-align:center;">Cancel</button>
        </span>
      </div>`;
    }).join("");

    const activeSection = activeMods.length
      ? `<div style="font-size:0.8em;padding:4px 6px;border:1px solid var(--color-border-light-secondary);border-radius:4px;">
          <strong>Active modifiers</strong>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 110px 88px 64px;gap:8px;align-items:center;margin-top:6px;padding-bottom:4px;font-weight:600;border-bottom:1px solid var(--color-border-light-secondary);">
            <span>Modifier</span>
            <span>Duration Left</span>
            <span>Applied</span>
            <span style="text-align:right;">Action</span>
          </div>
          ${activeModRows}
          <div style="margin-top:4px;border-top:1px solid var(--color-border-light-secondary);padding-top:4px;">
            <button type="button" class="cv-mod-clear-all" title="Cancel all active modifiers" style="width:auto;padding:1px 8px;font-size:0.8em;"><i class="fas fa-trash-can"></i> Cancel All</button>
          </div>
        </div>`
      : `<div style="font-size:0.8em;padding:4px 6px;border:1px solid var(--color-border-light-secondary);border-radius:4px;">
          <strong>Active modifiers:</strong> None
        </div>`;

    const statSlidersMarkup = configuredStats.map((statKey, index) => `
      <label>${getCharacteristicLabel(statKey)} modifier:</label>
      <input type="range" id="cv-mod-${index}" min="-10" max="10" step="1" value="0" oninput="this.nextElementSibling.textContent=this.value;"/>
      <span id="cv-mod-${index}-val">0</span>
    `).join("");

    const result = await new Promise(resolve => {
      const dlg = new Dialog({
        title: `Temporary Combat Value Modifiers — ${token.name}`,
        content: `
          <div style="display:grid;gap:8px;margin-top:4px;">
            <p style="margin:0;font-size:0.85em;color:var(--color-text-dark-secondary);">
              Right-click combat values. Apply temporary characteristic changes for a fixed number of segments.
            </p>
            ${activeSection}

            <div style="display:grid;grid-template-columns:130px 1fr 42px;gap:6px 8px;align-items:center;">
              ${statSlidersMarkup}
            </div>

            <div style="display:flex;align-items:center;gap:8px;">
              <label style="min-width:130px;flex-shrink:0;">Duration (segments):</label>
              <input type="number" id="cv-segments" min="1" value="1" style="width:72px;"/>
            </div>
          </div>
        `,
        buttons: {
          apply: {
            icon: '<i class="fas fa-check"></i>',
            label: "Apply New",
            callback: html => {
              const statMods = {};
              configuredStats.forEach((statKey, index) => {
                const delta = parseInt(html.find(`#cv-mod-${index}`).val()) || 0;
                if (!delta) return;
                statMods[statKey] = delta;
              });

              resolve({
                action: "apply",
                statMods,
                segments: parseInt(html.find("#cv-segments").val()) || 1
              });
            }
          },
          cancel: { label: "Close", callback: () => resolve(null) }
        },
        default: "apply",
        render: html => {
          html.find(".cv-mod-remove").click(ev => {
            ev.preventDefault();
            const idx = parseInt(ev.currentTarget.dataset.modIndex);
            resolve({ action: "remove", modIndex: idx });
            dlg.close();
          });
          html.find(".cv-mod-edit").click(ev => {
            ev.preventDefault();
            const idx = parseInt(ev.currentTarget.dataset.modIndex);
            resolve({ action: "edit", modIndex: idx });
            dlg.close();
          });
          html.find(".cv-mod-clear-all").click(ev => {
            ev.preventDefault();
            resolve({ action: "clear" });
            dlg.close();
          });
        }
      });
      dlg.render(true);
    });

    if (!result) return;

    const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase")   ?? 1;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;

    // --- Clear All ---
    if (result.action === "clear") {
      const total = sumCombatValueMods(activeMods);
      const updates = {};
      for (const [statKey, delta] of Object.entries(total)) {
        Object.assign(updates, getCharacteristicUpdateData(actor, statKey, -delta));
      }

      if (Object.keys(updates).length) await actor.update(updates);
      await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");

      createCombatChatMessage(`<strong>${token.name}</strong> combat value modifiers cleared.`, phase, segment);

      await this.render(true);
      return;
    }

    // --- Remove Single ---
    if (result.action === "remove") {
      const idx = result.modIndex;
      const mod = activeMods[idx];
      if (!mod) return;

      const modDeltas = getCombatValueModsFromEntry(mod);
      const updates = {};
      for (const [statKey, delta] of Object.entries(modDeltas)) {
        Object.assign(updates, getCharacteristicUpdateData(actor, statKey, -delta));
      }
      if (Object.keys(updates).length) await actor.update(updates);

      const remaining = activeMods.filter((_, i) => i !== idx);
      if (remaining.length) {
        await token.document.setFlag("hero-combat-engine", "cvSegmentMods", remaining);
      } else {
        await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
      }

      const parts = formatCombatValueModParts(modDeltas, configuredStats);
      createCombatChatMessage(`<strong>${token.name}</strong> modifier removed: ${parts.join(", ")}.`, phase, segment);

      await this.render(true);
      return;
    }

    // --- Edit Single (re-open dialog pre-filled) ---
    if (result.action === "edit") {
      const idx = result.modIndex;
      const mod = activeMods[idx];
      if (!mod) return;

      const existingMods = getCombatValueModsFromEntry(mod);
      const existingRemaining = getCvModifierRemainingSegments(mod, currentPhase, currentSegment);

      const editSlidersMarkup = configuredStats.map((statKey, si) => {
        const val = Number(existingMods[statKey] ?? 0);
        return `
          <label>${getCharacteristicLabel(statKey)} modifier:</label>
          <input type="range" id="cv-edit-${si}" min="-10" max="10" step="1" value="${val}" oninput="this.nextElementSibling.textContent=this.value;"/>
          <span id="cv-edit-${si}-val">${val}</span>
        `;
      }).join("");

      const editResult = await new Promise(resolve => {
        new Dialog({
          title: `Edit Modifier — ${token.name}`,
          content: `
            <div style="display:grid;gap:8px;margin-top:4px;">
              <div style="display:grid;grid-template-columns:130px 1fr 42px;gap:6px 8px;align-items:center;">
                ${editSlidersMarkup}
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <label style="min-width:130px;flex-shrink:0;">Duration (segments):</label>
                <input type="number" id="cv-edit-segments" min="1" value="${existingRemaining}" style="width:72px;"/>
              </div>
            </div>
          `,
          buttons: {
            save: {
              icon: '<i class="fas fa-check"></i>',
              label: "Save",
              callback: html => {
                const statMods = {};
                configuredStats.forEach((statKey, si) => {
                  const delta = parseInt(html.find(`#cv-edit-${si}`).val()) || 0;
                  if (!delta) return;
                  statMods[statKey] = delta;
                });
                resolve({
                  statMods,
                  segments: parseInt(html.find("#cv-edit-segments").val()) || 1
                });
              }
            },
            cancel: { label: "Cancel", callback: () => resolve(null) }
          },
          default: "save"
        }).render(true);
      });

      if (!editResult) return;

      if (!Object.keys(editResult.statMods).length) {
        ui.notifications.warn("Set at least one combat value modifier, or remove the entry instead.");
        return;
      }

      // Revert old deltas, apply new ones
      const oldDeltas = getCombatValueModsFromEntry(mod);
      const revertUpdates = {};
      for (const [statKey, delta] of Object.entries(oldDeltas)) {
        Object.assign(revertUpdates, getCharacteristicUpdateData(actor, statKey, -delta));
      }
      const applyUpdates = {};
      for (const [statKey, delta] of Object.entries(editResult.statMods)) {
        Object.assign(applyUpdates, getCharacteristicUpdateData(actor, statKey, delta));
      }
      const merged = { ...revertUpdates };
      for (const [path, val] of Object.entries(applyUpdates)) {
        merged[path] = (merged[path] ?? 0) + val - (revertUpdates[path] ?? 0);
        // Re-derive: just use actor's current value adjusted by net delta
      }
      // Simpler: revert old, then apply new in sequence
      if (Object.keys(revertUpdates).length) await actor.update(revertUpdates);
      if (Object.keys(applyUpdates).length) await actor.update(applyUpdates);

      const newEntry = createCvModifierEntry(editResult.statMods, editResult.segments, phase, segment);
      const updated = [...activeMods];
      updated[idx] = newEntry;
      await token.document.setFlag("hero-combat-engine", "cvSegmentMods", updated);

      const parts = formatCombatValueModParts(editResult.statMods, configuredStats);
      createCombatChatMessage(`<strong>${token.name}</strong> modifier updated: ${parts.join(", ")} for ${editResult.segments} segment${editResult.segments === 1 ? "" : "s"}.`, phase, segment);

      await this.render(true);
      return;
    }

    // --- Apply New ---
    const segments = Math.max(1, result.segments);
    if (!Object.keys(result.statMods ?? {}).length) {
      ui.notifications.warn("Set at least one combat value modifier.");
      return;
    }

    const updates = {};
    for (const [statKey, delta] of Object.entries(result.statMods)) {
      Object.assign(updates, getCharacteristicUpdateData(actor, statKey, delta));
    }
    await actor.update(updates);

    const newEntry = createCvModifierEntry(result.statMods, segments, phase, segment);

    await token.document.setFlag("hero-combat-engine", "cvSegmentMods", [...activeMods, newEntry]);

    const parts = formatCombatValueModParts(result.statMods, configuredStats);

    createCombatChatMessage(`<strong>${token.name}</strong> temporary combat value mod applied: ${parts.join(", ")} for ${segments} segment${segments === 1 ? "" : "s"}.`, phase, segment);

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
    createCombatChatMessage(`<strong>${token.name}</strong> takes a Recovery.<br>STUN ${stun} → ${newStun} &nbsp;|&nbsp; END ${end} → ${newEnd}`, phase, segment);

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
      const adjustments = token.document.getFlag("hero-combat-engine", "adjustments") ?? [];
      const bonusUpdates = getRevertUpdatesForBonusFlags(actor, token.document);
      const combinedDeltas = {};
      for (const [statKey, delta] of Object.entries(getRevertDeltaMapForCvMods(activeMods))) {
        combinedDeltas[statKey] = (combinedDeltas[statKey] ?? 0) + Number(delta);
      }
      for (const [statKey, delta] of Object.entries(getRevertDeltaMapForAdjustments(adjustments))) {
        combinedDeltas[statKey] = (combinedDeltas[statKey] ?? 0) + Number(delta);
      }

      const updates = {};
      for (const [statKey, delta] of Object.entries(combinedDeltas)) {
        Object.assign(updates, getAdjustmentUpdateData(actor, statKey, delta));
      }
      Object.assign(updates, bonusUpdates);

      if (Object.keys(updates).length) await actor.update(updates);
      if (activeMods.length) await token.document.unsetFlag("hero-combat-engine", "cvSegmentMods");
      if (adjustments.length) await token.document.unsetFlag("hero-combat-engine", "adjustments");
      if (token.document.getFlag("hero-combat-engine", "coverDCV") != null) await token.document.unsetFlag("hero-combat-engine", "coverDCV");
      if (token.document.getFlag("hero-combat-engine", "ocvBonus") != null) await token.document.unsetFlag("hero-combat-engine", "ocvBonus");
      if (token.document.getFlag("hero-combat-engine", "mcvBonus") != null) await token.document.unsetFlag("hero-combat-engine", "mcvBonus");
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

  async _insertTokenAtFront(tokenId) {
    if (!canvas?.scene) return;
    const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
    const phase = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;

    // Get the token to insert
    const tokenToInsert = canvas.tokens.get(tokenId);
    if (!tokenToInsert) return;

    // Get the acting tokens for this segment
    const actingTokens = getActingTokens(segment);
    
    // Remove the token from its natural position (if in list)
    const withoutToken = actingTokens.filter(t => t.id !== tokenId);
    
    // Insert at the front
    withoutToken.unshift(tokenToInsert);
    
    // Write a per-segment acting override so only this segment's order is affected
    await canvas.scene.setFlag("hero-combat-engine", "hero-combat.segmentOverride", withoutToken.map(t => t.id));
    
    // Set index to 0 (the inserted token now acts first)
    await canvas.scene.setFlag("hero-combat-engine", "heroCurrentActingIndex", 0);
    
    // Post chat message if enabled
    if (game.settings.get("hero-combat-engine", "chatTokenTurns")) {
      createCombatChatMessage(`<strong>${tokenToInsert.name}</strong> takes their turn now.`, phase, segment);
    }
    
    // Refresh the tracker UI to show the new order
    await this.render(true);
  }
}
