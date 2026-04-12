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

  getData() {
    const s = (key) => game.settings.get("hero-combat-engine", key);
    const tieBreakStat = s("tieBreakStat");
    const accessibilitySize = s("accessibilitySize") || "compact";
    return {
      debugMode:              s("debugMode"),
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
      showPreBar:             s("showPreBar"),
      trackedPipCharacteristics: s("trackedPipCharacteristics"),
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
      statColorOut:  s("statColorOut")
    };
  }

  async _updateObject(event, formData) {
    const numericKeys = new Set([
      "ringStrokeWidth", "ringInset", "burstDuration",
      "glowBright", "glowDim", "glowAlpha",
      "recoveryBodyThreshold", "recoveryStunEveryPhase",
      "recoveryStunPost12Only", "recoveryStunOnceAMinute",
      "statLessAt", "statHalfAt", "statHurtAt"
    ]);
    for (const [key, value] of Object.entries(formData)) {
      const coerced = numericKeys.has(key) ? Number(value) : value;
      await game.settings.set("hero-combat-engine", key, coerced);
    }
  }
}
