export function heroLog(...args) {
  if (game.settings.get("hero-combat-engine", "debugMode")) console.log("[HERO]", ...args);
}
