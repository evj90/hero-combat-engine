import { segmentAdvance, nextActingToken, previousActingToken, previousSegment, endTokenSegment, holdToken, releaseHold } from "./segment-engine.js";
import { HeroControllerPanel } from "./controller-panel.js";
import { HeroCombatSettingsMenu } from "./settings-menu.js";
import { beginCombat, addSelectedTokens, refreshCombatOrder } from "./begin-combat.js";
import { highlightActing, registerHighlightSocketListener, clearHighlights } from "./highlight.js";
import { endCombat } from "./end-combat.js";
import { SPD_MAP } from "./spd-map.js";

Hooks.once("init", () => {
  game.heroCombat = game.heroCombat || {};

  game.settings.registerMenu("hero-combat-engine", "settingsMenu", {
    name: "HERO Combat Settings",
    label: "Configure",
    icon: "fas fa-cogs",
    type: HeroCombatSettingsMenu,
    restricted: true
  });

  // Register debug setting
  game.settings.register("hero-combat-engine", "debugMode", {
    name: "Debug Mode",
    hint: "Post debug messages to the chat window. Disable for cleaner gameplay.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // ── Ring Appearance ──────────────────────────────────────────
  game.settings.register("hero-combat-engine", "ringColorActive", {
    name: "Active Token Ring Color",
    hint: "Color of the persistent ring drawn around the currently acting token (hex, e.g. #00ff00).",
    scope: "world",
    config: false,
    type: String,
    default: "#00ff00"
  });

  game.settings.register("hero-combat-engine", "ringColorIncapacitated", {
    name: "Incapacitated Token Ring Color",
    hint: "Color of the ring drawn around a dead or unconscious acting token (hex, e.g. #ff0000).",
    scope: "world",
    config: false,
    type: String,
    default: "#ff0000"
  });

  game.settings.register("hero-combat-engine", "ringColorBurst", {
    name: "Burst Ring Color",
    hint: "Color of the temporary ring flashed on all acting tokens at segment start (hex, e.g. #ffff00).",
    scope: "world",
    config: false,
    type: String,
    default: "#ffff00"
  });

  game.settings.register("hero-combat-engine", "ringStrokeWidth", {
    name: "Ring Stroke Width",
    hint: "Thickness of the highlight ring drawn around tokens (pixels).",
    scope: "world",
    config: false,
    type: Number,
    default: 4
  });

  game.settings.register("hero-combat-engine", "ringInset", {
    name: "Ring Inset",
    hint: "Padding added around the token when drawing the highlight ring (pixels).",
    scope: "world",
    config: false,
    type: Number,
    default: 15
  });

  game.settings.register("hero-combat-engine", "burstDuration", {
    name: "Burst Highlight Duration (ms)",
    hint: "How long the burst starburst flashes on all acting tokens at segment start, in milliseconds.",
    scope: "world",
    config: false,
    type: Number,
    default: 3000
  });

  game.settings.register("hero-combat-engine", "glowBright", {
    name: "Active Glow: Bright Radius",
    hint: "Bright light radius of the pulsing glow on the acting token, in scene distance units. 0 = soft glow only.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register("hero-combat-engine", "glowDim", {
    name: "Active Glow: Dim Radius",
    hint: "Dim light radius of the pulsing glow on the acting token, in scene distance units.",
    scope: "world",
    config: false,
    type: Number,
    default: 5
  });

  game.settings.register("hero-combat-engine", "glowAlpha", {
    name: "Active Glow: Intensity",
    hint: "Color intensity of the pulsing glow. 0.0 = invisible, 1.0 = fully saturated.",
    scope: "world",
    config: false,
    type: Number,
    default: 0.6
  });

  // ── Chat Verbosity ────────────────────────────────────────────
  game.settings.register("hero-combat-engine", "chatTokenTurns", {
    name: "Show Token Turn Messages",
    hint: "Post a chat message each time a token's turn begins (\"X is first to act\", \"X now acts\").",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "chatSegmentSummary", {
    name: "Show Segment Advance Summary",
    hint: "Post a chat message listing which SPDs and tokens act when a new segment begins.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "chatPost12Recovery", {
    name: "Show Post-Segment 12 Recovery Messages",
    hint: "Post a chat message listing tokens that were skipped for post-Segment 12 recovery.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  // ── Post-Segment 12 Recovery Thresholds ───────────────────────
  game.settings.register("hero-combat-engine", "recoveryBodyThreshold", {
    name: "Recovery: BODY Dead/Dying Threshold",
    hint: "Tokens with BODY at or below this value are considered dead or dying and skip post-Segment 12 recovery.",
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register("hero-combat-engine", "recoveryStunEveryPhase", {
    name: "Recovery: STUN \"Every Phase\" Threshold",
    hint: "Tokens with STUN at or above this value may recover every Phase and post-Segment 12.",
    scope: "world",
    config: false,
    type: Number,
    default: -10
  });

  game.settings.register("hero-combat-engine", "recoveryStunPost12Only", {
    name: "Recovery: STUN \"Post-Segment 12 Only\" Threshold",
    hint: "Tokens with STUN at or above this value (but below the Every-Phase threshold) may only recover post-Segment 12.",
    scope: "world",
    config: false,
    type: Number,
    default: -20
  });

  game.settings.register("hero-combat-engine", "recoveryStunOnceAMinute", {
    name: "Recovery: STUN \"Once a Minute\" Threshold",
    hint: "Tokens with STUN at or above this value (but below Post-12 Only) may only recover once a minute. Below this is GM\u2019s option.",
    scope: "world",
    config: false,
    type: Number,
    default: -30
  });

  // ── Tracker Behavior ──────────────────────────────────────────
  game.settings.register("hero-combat-engine", "autoOpenTrackerPlayers", {
    name: "Auto-Open Tracker for Players",
    hint: "Automatically open the Segment Tracker panel for all players when combat begins.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "autoCloseTrackerOnEnd", {
    name: "Auto-Close Tracker on Combat End",
    hint: "Automatically close the Segment Tracker for all connected clients when combat ends.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "showSpdColumn", {
    name: "Show SPD Column in Tracker",
    hint: "Display each token's SPD value in the Segment Tracker.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "trackedPipCharacteristics", {
    name: "Tracked Pip Characteristics",
    hint: "Comma-separated characteristic keys to show as pip bars (for example: stun,body,end,pre).",
    scope: "world",
    config: false,
    type: String,
    default: "stun,body,end"
  });

  game.settings.register("hero-combat-engine", "expandedAccessibility", {
    name: "Expanded Accessibility Mode",
    hint: "Increase tracker text size and control hit areas for easier readability and interaction.",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register("hero-combat-engine", "accessibilitySize", {
    name: "Tracker Accessibility Size",
    hint: "Choose Compact, Medium, or Large tracker sizing for readability and click targets.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      compact: "Compact",
      medium: "Medium",
      large: "Large"
    },
    default: "compact"
  });

  game.settings.register("hero-combat-engine", "hideNonActing", {
    name: "Hide Non-Acting Tokens in Tracker",
    hint: "Only show tokens that can act in the current segment. Tokens that are waiting or inactive are hidden.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  // ── Turn Management ───────────────────────────────────────────
  game.settings.register("hero-combat-engine", "playerSelfAdvance", {
    name: "Players Can Advance Any Token's Turn",
    hint: "When enabled, any player can click Done on the acting token, not just its owner.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register("hero-combat-engine", "warnSkipActing", {
    name: "Warn Before Skipping Acting Tokens",
    hint: "Show a confirmation dialog when the GM advances the segment while some tokens haven't taken their turn yet.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register("hero-combat-engine", "autoSkipEmptySegments", {
    name: "Auto-Skip Empty Segments",
    hint: "Automatically advance past segments where no combatants act, without stopping to display them.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "autoSkipIncapacitated", {
    name: "Auto-Skip Dead/Unconscious Tokens",
    hint: "Automatically skip tokens with BODY <= 0 or STUN <= 0 when determining acting turns.",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register("hero-combat-engine", "chatSkipEmptySegment", {
    name: "Chat Message on Empty Segment Skip",
    hint: "Post a chat message listing which segments were skipped when auto-skipping empty segments.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register("hero-combat-engine", "tieBreakStat", {
    name: "DEX Tie-Break Characteristic",
    hint: "Secondary characteristic used to break ties when multiple tokens share the same DEX.",
    scope: "world",
    config: false,
    type: String,
    choices: {
      "end": "END (Endurance)",
      "ego": "EGO (Ego)"
    },
    default: "end"
  });

  // ── Stat Condition Thresholds & Colors ─────────────────────
  game.settings.register("hero-combat-engine", "statLessAt", {
    name: "Stat Condition: Less threshold (%)",
    hint: "Percentage at or above which a stat shows 'Less' (just below Full). Default: 75.",
    scope: "world", config: false, type: Number, default: 75
  });
  game.settings.register("hero-combat-engine", "statHalfAt", {
    name: "Stat Condition: Half threshold (%)",
    hint: "Percentage at or above which a stat shows 'Half'. Default: 50.",
    scope: "world", config: false, type: Number, default: 50
  });
  game.settings.register("hero-combat-engine", "statHurtAt", {
    name: "Stat Condition: Hurt threshold (%)",
    hint: "Percentage at or above which a stat shows 'Hurt'. Below this and above 0 shows 'Risk'. Default: 25.",
    scope: "world", config: false, type: Number, default: 25
  });
  game.settings.register("hero-combat-engine", "statColorFull", {
    name: "Stat Color: Full",
    hint: "Color for stat at 100%. Hex, e.g. #4caf50.",
    scope: "world", config: false, type: String, default: "#4caf50"
  });
  game.settings.register("hero-combat-engine", "statColorLess", {
    name: "Stat Color: Less",
    hint: "Color for stat in the 'Less' range. Hex, e.g. #8bc34a.",
    scope: "world", config: false, type: String, default: "#8bc34a"
  });
  game.settings.register("hero-combat-engine", "statColorHalf", {
    name: "Stat Color: Half",
    hint: "Color for stat in the 'Half' range. Hex, e.g. #ffc107.",
    scope: "world", config: false, type: String, default: "#ffc107"
  });
  game.settings.register("hero-combat-engine", "statColorHurt", {
    name: "Stat Color: Hurt",
    hint: "Color for stat in the 'Hurt' range. Hex, e.g. #ff7043.",
    scope: "world", config: false, type: String, default: "#ff7043"
  });
  game.settings.register("hero-combat-engine", "statColorRisk", {
    name: "Stat Color: Risk",
    hint: "Color for stat in the 'Risk' range (danger, very low). Hex, e.g. #e53935.",
    scope: "world", config: false, type: String, default: "#e53935"
  });
  game.settings.register("hero-combat-engine", "statColorOut", {
    name: "Stat Color: Out",
    hint: "Color for stat at 0 or incapacitated. Hex, e.g. #888888.",
    scope: "world", config: false, type: String, default: "#888888"
  });

  /**
   * Conditionally post a debug message to chat if debug mode is enabled.
   */
  game.heroCombat.postDebugMessage = function(content) {
    const debugEnabled = game.settings.get("hero-combat-engine", "debugMode");
    if (!debugEnabled) return;
    ChatMessage.create({
      speaker: { alias: "Combat Engine DEBUG" },
      content: `<span style="color: #999;">${content}</span>`
    });
  };
});

Hooks.once("ready", async () => {
  // Load bucket descriptions from editable JSON file in the module folder.
  try {
    const modulePath = game.modules.get("hero-combat-engine")?.path ?? "modules/hero-combat-engine";
    const response = await fetch(`${modulePath}/data/bucket-descriptions.json`);
    if (response.ok) {
      game.heroCombat.bucketDescriptions = await response.json();
    } else {
      game.heroCombat.bucketDescriptions = {};
      console.warn("HERO Combat Engine | failed to load bucket-descriptions.json", response.status);
    }
  } catch (err) {
    game.heroCombat.bucketDescriptions = {};
    console.warn("HERO Combat Engine | error loading bucket-descriptions.json", err);
  }

  registerHighlightSocketListener();

  // Assign functions to game.heroCombat
  game.heroCombat.segmentAdvance = segmentAdvance;
  game.heroCombat.beginCombat = beginCombat;
  game.heroCombat.highlightActing = highlightActing;
  game.heroCombat.clearHighlights = clearHighlights;
  game.heroCombat.nextActingToken = nextActingToken;
  game.heroCombat.previousActingToken = previousActingToken;
  game.heroCombat.endCombat = endCombat;
  game.heroCombat.endTokenSegment = endTokenSegment;
  game.heroCombat.addSelectedTokens = addSelectedTokens;
  game.heroCombat.previousSegment = previousSegment;
  game.heroCombat.SPD_MAP = SPD_MAP;
  game.heroCombat.refreshCombatOrder = refreshCombatOrder;
  game.heroCombat.holdToken = holdToken;
  game.heroCombat.releaseHold = releaseHold;

  // Add a button to the left sidebar
  Hooks.on("getSceneControlButtons", controls => {
    try {
      const tokenGroup = controls.find(c => c.name === "token") || controls[0];
      if (!tokenGroup.tools) tokenGroup.tools = [];
      tokenGroup.tools.push({
        name: "heroTracker",
        title: "HERO Segment Tracker",
        icon: "fas fa-swords",
        togglable: false,
        visible: true,
        onClick: () => {
          if (game.heroCombat.heroControllerPanel) {
            game.heroCombat.heroControllerPanel.render(true);
          } else {
            game.heroCombat.heroControllerPanel = new HeroControllerPanel();
            game.heroCombat.heroControllerPanel.render(true);
          }
        }
      });
    } catch (err) {
      console.error("HERO Combat Engine | error adding scene control button:", err);
    }
  });

  // Store reference to controller panel for show/hide on combat start/end
  game.heroCombat.heroControllerPanel = null;

  // Consolidated socket handler for GM-only actions and tracker visibility
  function userOwnsToken(userId, tokenId) {
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor) return false;
    const ownerIds = Object.entries(token.actor.ownership ?? {})
      .filter(([id, p]) => id !== "default" && p >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
      .map(([id]) => id);
    return ownerIds.includes(userId);
  }

  game.socket.on("module.hero-combat-engine", async (data) => {
    if (!data) return;
    const playerSelfAdvance = game.settings.get("hero-combat-engine", "playerSelfAdvance");
    if (data.type === "end-turn" && game.user.isGM) {
      if (data.userId && !playerSelfAdvance && !userOwnsToken(data.userId, data.tokenId)) return;
      if (game.heroCombat?.endTokenSegment) {
        await game.heroCombat.endTokenSegment(data.tokenId);
      }
    } else if (data.type === "remove-combatant" && game.user.isGM) {
      if (data.userId && !userOwnsToken(data.userId, data.tokenId)) return;
      if (game.heroCombat.heroControllerPanel) {
        await game.heroCombat.heroControllerPanel._removeToken(data.tokenId);
      }
    } else if (data.type === "take-recovery" && game.user.isGM) {
      if (data.userId && !userOwnsToken(data.userId, data.tokenId)) return;
      if (game.heroCombat.heroControllerPanel) {
        await game.heroCombat.heroControllerPanel._applyRecovery(data.tokenId);
      }
    } else if (data.type === "hold-token" && game.user.isGM) {
      if (data.userId && !userOwnsToken(data.userId, data.tokenId)) return;
      await holdToken(data.tokenId);
    } else if (data.type === "release-hold" && game.user.isGM) {
      if (data.userId && !userOwnsToken(data.userId, data.tokenId)) return;
      await releaseHold(data.tokenId);
    } else if (data.type === "toggle-abort" && game.user.isGM) {
      if (data.userId && !userOwnsToken(data.userId, data.tokenId)) return;
      if (game.heroCombat.heroControllerPanel) {
        await game.heroCombat.heroControllerPanel._toggleAbort(data.tokenId);
      }
    } else if (data.type === "open-tracker" && !game.user.isGM) {
      if (game.heroCombat.heroControllerPanel) {
        game.heroCombat.heroControllerPanel.render(true);
      } else {
        game.heroCombat.heroControllerPanel = new HeroControllerPanel();
        game.heroCombat.heroControllerPanel.render(true);
      }
    } else if (data.type === "close-tracker" && !game.user.isGM) {
      if (game.heroCombat.heroControllerPanel) {
        game.heroCombat.heroControllerPanel.close();
        game.heroCombat.heroControllerPanel = null;
      }
    }
  });

  // Auto-render panels whenever hero-related scene flags change (works for all clients)
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id !== canvas.scene?.id) return;
    const heroFlags = changes?.flags?.["hero-combat-engine"];
    if (!heroFlags) return;
    if (Object.keys(heroFlags).some(k => k.startsWith("hero"))) {
      game.heroCombat?.heroControllerPanel?.render(true);
    }
  });

  // Auto-restore tracker panel when a scene with active HERO combat is loaded
  Hooks.on("canvasReady", () => {
    if (!game.user.isGM) return;
    const existingOrder = canvas.scene?.getFlag("hero-combat-engine", "hero-combat.actingOrder");
    if (existingOrder?.length && !(game.heroCombat.heroControllerPanel?.rendered)) {
      game.heroCombat.heroControllerPanel = new HeroControllerPanel();
      game.heroCombat.heroControllerPanel.render(true);
    }
  });
});
