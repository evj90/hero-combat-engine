import { SPD_MAP } from "./spd-map.js";
import { heroLog } from "./utils.js";

// Module-level references to the active PIXI burst animation.
// These are client-local and are never written to scene documents.
let _burstContainer = null;
let _burstTicker = null;

// Converts a CSS hex colour string ("#rrggbb") to the integer format PIXI.Graphics expects.
function hexToInt(hex) {
  return parseInt((hex ?? "#ffffff").replace("#", ""), 16);
}

// Draws the starburst graphic for a single token into a shared PIXI container.
// Produces two layers: a dashed ring that follows the token border, and
// eight radial spikes radiating outward from it.
function _addBurstGfx(container, token, colorInt, strokeWidth, inset) {
  const cx = token.x + token.w / 2;
  const cy = token.y + token.h / 2;
  const rx = token.w / 2 + inset;
  const ry = token.h / 2 + inset;

  // Divide the token's border ellipse into 16 arcs, drawing 55% of each arc
  // and leaving a gap between them to create a dashed ring effect.
  const ring = new PIXI.Graphics();
  const segCount = 16;
  for (let i = 0; i < segCount; i++) {
    const a0 = (i / segCount) * Math.PI * 2;
    const a1 = ((i + 0.55) / segCount) * Math.PI * 2;
    ring.lineStyle(strokeWidth, colorInt, 1);
    let first = true;
    for (let s = 0; s <= 8; s++) {
      const a = a0 + (a1 - a0) * (s / 8);
      const px = cx + Math.cos(a) * rx;
      const py = cy + Math.sin(a) * ry;
      if (first) { ring.moveTo(px, py); first = false; }
      else ring.lineTo(px, py);
    }
  }
  container.addChild(ring);

  // Draw eight lines from just inside the ring boundary outward, evenly spaced around the token.
  const spikes = new PIXI.Graphics();
  spikes.lineStyle(Math.max(1, strokeWidth * 0.6), colorInt, 0.75);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spikes.moveTo(cx + Math.cos(a) * rx * 0.88, cy + Math.sin(a) * ry * 0.88);
    spikes.lineTo(cx + Math.cos(a) * rx * 1.38, cy + Math.sin(a) * ry * 1.38);
  }
  container.addChild(spikes);
}

// Stops the burst ticker and destroys the PIXI container, releasing GPU memory.
function _clearBurst() {
  if (_burstTicker) {
    canvas.app?.ticker.remove(_burstTicker);
    _burstTicker = null;
  }
  if (_burstContainer) {
    _burstContainer.destroy({ children: true });
    _burstContainer = null;
  }
}

// Reads the current segment from the scene and returns every combatant token
// whose SPD chart puts them in that segment.
function _getActingInSegment() {
  if (!canvas?.scene) return [];
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const actingOrder = canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder") ?? [];
  const acting = [];
  for (const tokenId of actingOrder) {
    const t = canvas.tokens.get(tokenId);
    if (!t?.actor) continue;
    const spd = t.actor.system?.characteristics?.spd?.value ?? 0;
    if (SPD_MAP[spd]?.includes(segment)) acting.push(t);
  }
  return acting;
}

// Animates a starburst on each acting token using Foundry's bundled PIXI renderer.
// All drawing happens on canvas.interface (the top PIXI layer) and is never saved to
// the scene, so each client runs its own copy independently.
// Resolves when the animation finishes.
export function playBurst(actingTokens) {
  if (!canvas?.scene || !actingTokens.length) return Promise.resolve();
  _clearBurst();

  const colorInt    = hexToInt(game.settings.get("hero-combat-engine", "ringColorBurst"));
  const strokeWidth = game.settings.get("hero-combat-engine", "ringStrokeWidth");
  const inset       = game.settings.get("hero-combat-engine", "ringInset");
  const duration    = game.settings.get("hero-combat-engine", "burstDuration");

  const container = new PIXI.Container();
  canvas.interface.addChild(container);
  _burstContainer = container;

  for (const t of actingTokens) {
    _addBurstGfx(container, t, colorInt, strokeWidth, inset);
  }

  const startTime = Date.now();
  // Each frame: compute a sine pulse scaled by remaining time so the burst
  // flickers quickly at first then fades out as it approaches the duration limit.
  const ticker = () => {
    if (!_burstContainer) { canvas.app.ticker.remove(ticker); return; }
    const progress = (Date.now() - startTime) / duration;
    if (progress >= 1) { _clearBurst(); return; }
    const pulse = Math.sin(progress * Math.PI * 6) * 0.4 + 0.6;
    container.alpha = pulse * (1 - progress);
  };
  _burstTicker = ticker;
  canvas.app.ticker.add(ticker);

  return new Promise(resolve => setTimeout(() => { _clearBurst(); resolve(); }, duration));
}

// Removes all hero-combat-engine highlights from the current scene.
// Clears the client-local PIXI burst, deletes any AmbientLight glow documents
// the GM created, and removes legacy Drawing rings from older module versions.
export async function clearHighlights() {
  _clearBurst();
  if (!canvas?.scene) return;
  if (!game.user.isGM) return;
  // AmbientLight glow: find lights tagged by this module and delete them.
  const glows = canvas.scene.lights.filter(l => l.flags?.["hero-combat-engine"]?.currentGlow);
  if (glows.length) await canvas.scene.deleteEmbeddedDocuments("AmbientLight", glows.map(l => l.id));
  // Legacy cleanup: remove Drawing rings written by versions prior to the PIXI rewrite.
  const oldRings = canvas.scene.drawings.filter(d =>
    d.flags?.["hero-combat-engine"]?.burstRing || d.flags?.["hero-combat-engine"]?.currentRing
  );
  if (oldRings.length) await canvas.scene.deleteEmbeddedDocuments("Drawing", oldRings.map(r => r.id));
}

// Called by the GM when the segment advances.
// Clears any existing highlights, broadcasts a socket message so non-GM clients
// play the burst locally, then places a persistent AmbientLight glow on the
// token that is currently first in the acting order.
export async function highlightActing() {
  if (!canvas?.scene) return;
  const segment = canvas.scene.getFlag("hero-combat-engine", "heroSegment") ?? 1;
  const phase   = canvas.scene.getFlag("hero-combat-engine", "heroPhase") ?? 1;
  heroLog("highlightActing called for phase", phase, "segment", segment);
  game.heroCombat.postDebugMessage(`[DEBUG] highlightActing() - Phase ${phase}, Segment ${segment} - Highlighting acting tokens`);

  await clearHighlights();

  const acting = _getActingInSegment();
  heroLog("Found", acting.length, "acting tokens");
  if (!acting.length) return;

  // Tell non-GM clients to play the burst using their own local PIXI renderer.
  game.socket?.emit("module.hero-combat-engine", { type: "highlight-burst" });
  // GM plays the burst locally at the same time.
  await playBurst(acting);

  // Burst is done — place a persistent glow only on the current active token.
  const currentIndex = canvas.scene.getFlag("hero-combat-engine", "heroCurrentActingIndex") ?? 0;
  const currentToken = acting[currentIndex] ?? acting[0];
  if (currentToken) await highlightToken(currentToken.id);
}

// Creates a pulsing AmbientLight centred on the given token to mark it as the
// currently acting token. Only the GM can create scene documents; non-GMs see
// the light automatically because it is a shared scene document.
// Colour is amber for a healthy token and changes to the incapacitated colour
// when the token's STUN or BODY has dropped to zero.
export async function highlightToken(tokenId) {
  if (!canvas?.scene) return;
  if (!game.user.isGM) return;

  const token = canvas.tokens.get(tokenId);
  if (!token) return;

  // Delete any existing glow before placing a new one.
  const glows = canvas.scene.lights.filter(l => l.flags?.["hero-combat-engine"]?.currentGlow);
  if (glows.length) await canvas.scene.deleteEmbeddedDocuments("AmbientLight", glows.map(l => l.id));

  // Choose the glow colour based on whether the token is incapacitated.
  const stun = token.actor?.system?.characteristics?.stun?.value ?? 0;
  const body = token.actor?.system?.characteristics?.body?.value ?? 0;
  const isDead = body <= 0;
  const isUnconscious = stun <= 0;
  const glowColor  = (isDead || isUnconscious)
    ? game.settings.get("hero-combat-engine", "ringColorIncapacitated")
    : game.settings.get("hero-combat-engine", "ringColorActive");
  const glowBright = game.settings.get("hero-combat-engine", "glowBright");
  const glowDim    = game.settings.get("hero-combat-engine", "glowDim");
  const glowAlpha  = game.settings.get("hero-combat-engine", "glowAlpha");

  await canvas.scene.createEmbeddedDocuments("AmbientLight", [{
    x: token.center.x,
    y: token.center.y,
    walls: false,
    config: {
      bright: glowBright,
      dim: glowDim,
      color: glowColor,
      alpha: glowAlpha,
      angle: 360,
      animation: { type: "pulse", speed: 3, intensity: 5, reverse: false },
      darkness: { min: 0, max: 1 }
    },
    flags: { "hero-combat-engine": { currentGlow: true } }
  }]);
}

// Registers the module's socket listener on the current client.
// Non-GM clients listen for the "highlight-burst" message and play
// the burst animation locally using their own PIXI renderer.
// The AmbientLight glow does not need a socket message because it is
// a scene document that Foundry syncs to all connected clients automatically.
export function registerHighlightSocketListener() {
  game.socket.on("module.hero-combat-engine", async (data) => {
    if (!data) return;
    if (data.type === "highlight-burst" && !game.user.isGM) {
      await playBurst(_getActingInSegment());
    }
  });
}