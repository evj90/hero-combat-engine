# Development Guide

This guide explains how to set up and develop the HERO Combat Engine locally.

## Project Structure

```
hero-combat-engine/
├── scripts/               # JavaScript modules
│   ├── main.js                 # Entry point, initializes module
│   ├── controller-panel.js     # Floating panel UI and logic
│   ├── segment-engine.js       # Segment/phase timing logic
│   ├── begin-combat.js         # Combat initialization
│   ├── end-combat.js           # Combat cleanup
│   ├── highlight.js            # Token highlighting system
│   ├── spd-map.js              # SPD → segment lookup table
│   ├── settings-menu.js        # Settings menu Application
│   ├── attack-sheet-tooltips.js # Attack tooltip helpers
│   ├── mental-illusion-macro.js # Mental Illusion macro
│   ├── utils.js                # Shared utilities
│   ├── macro-registry.generated.js # Auto-generated macro loader
│   └── macros/                 # Source-controlled macro scripts
│       ├── Full Health.js
│       ├── Grapple.js
│       ├── recover.js
│       ├── Remove Status Effects.js
│       ├── Rotate CW.js
│       └── Set Upright.js
├── styles/               # CSS
│   └── hero-panel.css    # All module styles
├── templates/            # Handlebars HTML templates
│   ├── controller-panel.html
│   └── settings-menu.html
├── tools/                # Build scripts
│   └── build-macro-registry.mjs
├── lang/                 # Localization files
├── data/                 # Configuration data
│   └── bucket-descriptions.json
├── packs/                # Foundry compendium packs
│   └── hero-macros.db
├── images/               # Screenshots and assets
├── docs/                 # Developer documentation
├── module.json           # Module manifest
├── CHANGELOG.md          # Version history
└── README.md             # User documentation
```

## Setup

### 1. Install Foundry VTT
Download and install Foundry VTT v11 from foundrydata.com.

### 2. Create a Test World
- Create a world with your preferred game system (e.g., D&D 5e)
- Use HERO System data if available, or mock it with custom character abilities

### 3. Link the Module
**Option A: Symlink (recommended for live testing)**
```bash
# Windows (PowerShell as Administrator)
New-Item -ItemType SymbolicLink -Path "C:\Users\YourUser\AppData\Local\FoundryVTT\Data\modules\hero-combat-engine" -Target "C:\path\to\hero-combat-engine"

# macOS/Linux
ln -s /path/to/hero-combat-engine ~/Library/Application\ Support/FoundryVTT/Data/modules/
```

**Option B: Copy the folder**
- Copy the entire `hero-combat-engine/` to `Foundry/Data/modules/`
- Reload Foundry after each code change

### 4. Enable the Module
1. Open Foundry, launch your test world
2. Go to **Settings** → **Manage Modules**
3. Enable "HERO Combat Engine"
4. Reload the world

## Testing Combat

### Basic Workflow

1. **Create test tokens** with HERO-style characteristics:
   - SPD (Speed): 1-10
   - DEX, EGO (for ties)
   - STUN, BODY (tracked as pips)
   - OCV, DCV, MCV (combat values)

2. **Place tokens on scene** and select them

3. **Open the controller panel:**
   - Click the toolbar icon (if visible)
   - Or press 'H' if hotkey is set

4. **Click "Begin"** to start combat from selected tokens

5. **Test actions:**
   - Advance segments (Previous/Next Segment)
   - Advance tokens (Previous/Next Token)
   - Test Hold, Release, Abort

### Debugging

#### Console Logging
- Use `console.error()` for errors users should see
- Use `heroLog()` for development-only messages (remove before commit)
- Open browser DevTools with **F12** or **Right-click → Inspect**

#### Chat Messages
- All segment/turn actions post to chat by default
- Check "Debug Mode" in module settings for extra diagnostic messages
- Watch chat for timing and order issues

#### Flag Data
Token flags store combat state. View them:
```javascript
// In console:
canvas.tokens.controlled[0].document.getFlag("hero-combat-engine", "cvSegmentMods")
```

Scene flags:
```javascript
canvas.scene.getFlag("hero-combat-engine", "hero-combat.actingOrder")
```

## Key Systems

### Segment/Phase Engine (`segment-engine.js`)

The core timing system implements HERO's 12-segment structure:
- **Phase:** Round counter (increments after segment 12)
- **Segment:** Position within a phase (1–12, determined by SPD chart)
- **Acting Order:** Sorted by DEX, with configurable END or EGO tie-breaks

Main functions:
- `segmentAdvance()` — Move to next segment or phase
- `previousSegment()` — Step backward
- `nextActingToken()` / `previousActingToken()` — Navigate within a segment
- `adjustmentFade()` — Process Drain/Aid fade per segment or phase
- `cvSegmentModifierTick()` — Expire timed combat value modifiers
- `segmentFlashRecovery()` — Reduce Flash Points each segment
- `post12RecoveryAllCombatants()` — Post-segment 12 automatic recovery
- Auto-skip empty segments when enabled

### Controller Panel (`controller-panel.js`)

The UI and interaction layer:
- `getData()` — Collects current combat state for template rendering
- `activateListeners()` — Wires up button clicks, context menus, and dialogs
- Direct updates (GMs) vs socket emissions (players)
- Temporary CV modifier dialog with per-modifier Edit, Remove, and Clear All
- Cover, OCV bonus, MCV bonus stage cycling
- Drain/Aid adjustment creation and management dialogs
- Entangle management dialog
- Quick status toggles and flash point prompts

Key data:
- `combatants` — Array of token data (name, stats, actions available)
- `phase`, `segment` — Current position in combat
- `currentActingTokenId` — The token whose turn it is

### Highlighting (`highlight.js`)

Visual indicators for acting tokens:
- PIXI starburst animation (local canvas)
- AmbientLight glow (placed on scene, visible to all)
- Configurable colors for active and incapacitated tokens

## Common Tasks

### Add a New Setting
1. Find the default settings registration in `main.js` (around line 300-400)
2. Add your setting with `game.settings.register()`
3. Access it with `game.settings.get("hero-combat-engine", "yourSetting")`
4. Add UI control to `settings-menu.html`
5. Document in README

### Modify Combat Value Display
1. Edit `controller-panel.js`, function `getData()`
2. Build `combatValueRows` array with desired properties
3. Update `controller-panel.html` template `combatValueRows` loop
4. Style with `hero-panel.css` `.hero-cv-*` classes

### Add Macros From Repo Files
Use this workflow to develop macros directly in source control instead of writing large scripts in the Foundry macro editor.

1. Add a JavaScript file under `scripts/macros/` (nested folders are supported).
2. Export one entry function from the file: `run(...)`, `default (...)`, or `execute(...)`.
3. Regenerate the static loader:

```bash
node tools/build-macro-registry.mjs
```

4. Reload the world/module in Foundry.
5. Call the macro by name:

```javascript
await game.heroCombat.runRegisteredMacro("your-macro-name")
```

Name mapping rules:
- `scripts/macros/foo.js` -> `"foo"`
- `scripts/macros/control/end-turn.js` -> `"control/end-turn"`

The generated file is `scripts/macro-registry.generated.js` and should be committed.

### Change Combat State Flags
1. Update read/write locations consistently across all files
2. Flag keys are stored as literal strings: `"hero-combat.actingOrder"` not nested
3. Test both single-player and multiplayer
4. Update CHANGELOG and any documentation

### Test Multiplayer
1. Open the module in two different browsers/profiles logged in as different users
2. Have one user (GM) start combat
3. Observe that non-GM users see correct UI and can't access restricted actions
4. Check socket emissions in `controller-panel.js` are received properly

## Performance Tips

- Don't query `getAllEmbedded()` inside loops; fetch once per render
- Use `Set` instead of `Array` for fast lookups (heldTokenIds, etc.)
- Debounce rapid updates (e.g., holding down a button)
- Minimize DOM updates by using Handlebars conditionals instead of jQuery

## Branching & Releases

### Preparing a Release
1. Update version in `module.json`
2. Add changes to `CHANGELOG.md`
3. Test thoroughly on `develop`
4. Create PR to `main`, merge
5. Tag the commit: `git tag v1.2.0`
6. Push: `git push origin main --tags`
7. Create GitHub Release with CHANGELOG section

### Versioning
Follow semantic versioning:
- **Major.Minor.Patch** (e.g., 1.1.0)
- Increment patch for bug fixes
- Increment minor for new features
- Increment major for breaking changes

## Getting Help

- **Questions?** Open a GitHub discussion or issue
- **Found a bug?** Check existing issues, then file a bug report
- **Want to contribute?** See CONTRIBUTING.md

---

**Happy coding!**
