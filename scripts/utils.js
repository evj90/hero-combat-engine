export function heroLog(...args) {
  if (game.settings.get("hero-combat-engine", "debugMode")) console.log("[HERO]", ...args);
}

export function combatEngineSpeaker(phase = null, segment = null, baseAlias = "Combat Engine") {
  if (phase == null || segment == null) return { alias: baseAlias };
  return { alias: `${baseAlias}: Segment ${phase}.${segment}` };
}
