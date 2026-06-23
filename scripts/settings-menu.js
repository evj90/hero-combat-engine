async function _loadAttackModifiersForSettings() {
  let defaults = [];
  try {
    const modPath = game.modules.get("hero-combat-engine")?.path ?? "modules/hero-combat-engine";
    const resp = await fetch(`${modPath}/data/attack-modifiers.json`);
    if (resp.ok) defaults = await resp.json();
  } catch {
    defaults = [];
  }

  let custom = [];
  try {
    const raw = game.settings.get("hero-combat-engine", "attackModifiers") ?? "[]";
    custom = JSON.parse(raw);
    if (!Array.isArray(custom)) custom = [];
  } catch {
    custom = [];
  }

  const map = new Map(defaults.map(m => [m.id, m]));
  for (const c of custom) {
    if (c?.id) map.set(c.id, { ...map.get(c.id), ...c });
  }
  return [...map.values()];
}

function _parseEnabledSituationalIds(raw) {
  if (raw === "__ALL__") return null;
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter(id => typeof id === "string" && id.length));
  } catch {
    return null;
  }
}

function _formatDeltaLabel(mod) {
  const ocv = Number(mod?.ocvMod ?? 0);
  const dcv = Number(mod?.dcvMod ?? 0);
  const parts = [];
  if (ocv) parts.push(`OCV ${ocv >= 0 ? "+" : ""}${ocv}`);
  if (dcv) parts.push(`DCV ${dcv >= 0 ? "+" : ""}${dcv}`);
  return parts.length ? parts.join(", ") : "No CV change";
}

export class HeroCombatSettingsMenu extends FormApplication {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      id: "hero-combat-settings",
      title: "HERO Combat Engine — Settings",
      template: "modules/hero-combat-engine/templates/settings-menu.html",
      width: 560,
      height: "auto",
      closeOnSubmit: true,
      scrollY: ["form"]
    });
  }

  async getData() {
    const s = (key) => game.settings.get("hero-combat-engine", key);
    const tieBreakStat = s("tieBreakStat");
    const accessibilitySize = s("accessibilitySize") || "compact";
    const attackModifiersJson = s("attackModifiers") ?? "[]";
    const enabledSituationalRaw = s("attackSituationalEnabledIds") ?? "__ALL__";
    const enabledSituationalIds = _parseEnabledSituationalIds(enabledSituationalRaw);
    const situationalModifiers = (await _loadAttackModifiersForSettings())
      .filter(m => m?.category === "situational")
      .map(m => ({
        id: m.id,
        name: m.name,
        description: m.description ?? "",
        deltaLabel: _formatDeltaLabel(m),
        isEnabled: enabledSituationalIds === null ? true : enabledSituationalIds.has(m.id)
      }));

    return {
      debugMode:              s("debugMode"),
      entangleDebugMode:      s("entangleDebugMode"),
      ringColorActive:        s("ringColorActive"),
      ringColorIncapacitated: s("ringColorIncapacitated"),
      ringColorBurst:         s("ringColorBurst"),
      ringStrokeWidth:        s("ringStrokeWidth"),
      ringInset:              s("ringInset"),
      burstDuration:          s("burstDuration"),
      glowBright:             s("glowBright"),
      glowDim:                s("glowDim"),
      glowAlpha:              s("glowAlpha"),
      chatTokenTurns:         s("chatTokenTurns"),
      chatSegmentSummary:     s("chatSegmentSummary"),
      chatPost12Recovery:     s("chatPost12Recovery"),
      recoveryBodyThreshold:    s("recoveryBodyThreshold"),
      recoveryStunEveryPhase:   s("recoveryStunEveryPhase"),
      recoveryStunPost12Only:   s("recoveryStunPost12Only"),
      recoveryStunOnceAMinute:  s("recoveryStunOnceAMinute"),
      autoOpenTrackerPlayers: s("autoOpenTrackerPlayers"),
      autoCloseTrackerOnEnd:  s("autoCloseTrackerOnEnd"),
      showSpdColumn:          s("showSpdColumn"),
      trackedPipCharacteristics: s("trackedPipCharacteristics"),
      combatValueCharacteristics: s("combatValueCharacteristics"),
      accessibilitySize,
      accessibilitySizeIsCompact: accessibilitySize === "compact",
      accessibilitySizeIsMedium: accessibilitySize === "medium",
      accessibilitySizeIsLarge: accessibilitySize === "large",
      hideNonActing:          s("hideNonActing"),
      playerSelfAdvance:      s("playerSelfAdvance"),
      warnSkipActing:         s("warnSkipActing"),
      autoSkipEmptySegments:  s("autoSkipEmptySegments"),
      autoSkipIncapacitated:  s("autoSkipIncapacitated"),
      chatSkipEmptySegment:   s("chatSkipEmptySegment"),
      tieBreakStat,
      tieBreakStatIsEnd: tieBreakStat === "end",
      tieBreakStatIsEgo: tieBreakStat === "ego",
      statLessAt:    s("statLessAt"),
      statHalfAt:    s("statHalfAt"),
      statHurtAt:    s("statHurtAt"),
      statColorFull: s("statColorFull"),
      statColorLess: s("statColorLess"),
      statColorHalf: s("statColorHalf"),
      statColorHurt: s("statColorHurt"),
      statColorRisk: s("statColorRisk"),
      statColorOut:  s("statColorOut"),
      attackModifiersJson,
      situationalModifiers
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const parseChars = val => val
      .split(/[,.\s;]+/)
      .map(s => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""))
      .filter(Boolean);
    const wirePreview = (inputId, previewId) => {
      const input = html.find(`#${inputId}`);
      const preview = html.find(`#${previewId}`);
      const refresh = () => {
        const keys = parseChars(input.val() || "");
        preview.text(keys.length ? "Will show: " + keys.map(k => k.toUpperCase()).join(" · ") : "");
      };
      input.on("input", refresh);
      refresh();
    };
    wirePreview("input-tracked-pip", "preview-tracked-pip");
    wirePreview("input-combat-value", "preview-combat-value");
  }

  async _updateObject(event, formData) {
    const attackModifiersRaw = String(formData.attackModifiersJson ?? "[]").trim() || "[]";
    let parsedAttackModifiers;
    try {
      parsedAttackModifiers = JSON.parse(attackModifiersRaw);
    } catch {
      ui.notifications.error("Attack Modifiers JSON is invalid. Fix JSON before saving settings.");
      return;
    }
    if (!Array.isArray(parsedAttackModifiers)) {
      ui.notifications.error("Attack Modifiers JSON must be an array.");
      return;
    }

    const situationalModifiers = (await _loadAttackModifiersForSettings()).filter(m => m?.category === "situational");
    const allSituationalIds = new Set(situationalModifiers.map(m => m.id).filter(Boolean));
    const selectedRaw = formData.situationalEnabledIds;
    const selectedIds = Array.isArray(selectedRaw)
      ? selectedRaw
      : (typeof selectedRaw === "string" && selectedRaw.length ? [selectedRaw] : []);
    const normalizedSelected = [...new Set(selectedIds.filter(id => allSituationalIds.has(id)))];

    const enabledSettingValue = normalizedSelected.length === allSituationalIds.size
      ? "__ALL__"
      : JSON.stringify(normalizedSelected);

    const numericKeys = new Set([
      "ringStrokeWidth", "ringInset", "burstDuration",
      "glowBright", "glowDim", "glowAlpha",
      "recoveryBodyThreshold", "recoveryStunEveryPhase",
      "recoveryStunPost12Only", "recoveryStunOnceAMinute",
      "statLessAt", "statHalfAt", "statHurtAt"
    ]);

    await game.settings.set("hero-combat-engine", "attackModifiers", JSON.stringify(parsedAttackModifiers));
    await game.settings.set("hero-combat-engine", "attackSituationalEnabledIds", enabledSettingValue);

    delete formData.attackModifiersJson;
    delete formData.situationalEnabledIds;

    for (const [key, value] of Object.entries(formData)) {
      const coerced = numericKeys.has(key) ? Number(value) : value;
      await game.settings.set("hero-combat-engine", key, coerced);
    }
  }
}
