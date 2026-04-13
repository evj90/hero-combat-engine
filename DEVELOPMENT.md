# Development Guide

This guide explains how to set up and develop the HERO Combat Engine locally.

## Project Structure

```
hero-combat-engine/
├── scripts/               # JavaScript modules
│   ├── main.js           # Entry point, initializes module
│   ├── controller-panel.js     # Floating panel UI and logic
│   ├── segment-engine.js       # Segment/phase timing logic
│   ├── begin-combat.js         # Combat initialization
│   ├── end-combat.js           # Combat cleanup
│   ├── highlight.js            # Token highlighting system
│   └── utils.js                # Shared utilities
├── styles/               # CSS
│   └── hero-panel.css    # All module styles
├── templates/            # Handlebars HTML templates
│   ├── controller-panel.html
│   └── settings-menu.html
├── lang/                 # Localization files
├── data/                 # Configuration data
├── packs/                # Foundry compendiums (if any)
├── module.json           # Module manifest
├── CHANGELOG.md          # Version history and changes
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

The core timing system converts HERO's 12-segment structure into JavaScript calls:
- **Phase:** Round (1-12)
- **Segment:** Section within a phase (1-12, determined by SPD)
- **Acting Order:** Sorted by SPD, then DEX/EGO for ties

Main functions:
- `segmentAdvance()` — Move to next segment or phase
- `autoSkip()` — Skip empty segments if enabled
- `manageHeld()` / `manageAborted()` — Handle special states

### Controller Panel (`controller-panel.js`)

The UI and interaction layer:
- `getData()` — Collects current combat state for template rendering
- `activateListeners()` — Wires up button clicks and dialogs
- Direct updates (GMs) vs socket emissions (players)

Key data:
- `combatants` — Array of token data (name, stats, actions available)
- `phase`, `segment` — Current position in combat
- `currentActingTokenId` — The token whose turn it is

### Highlighting (`highlight.js`)

Visual indicators for acting tokens:
- PIXI starburst (local, not multiplayer-safe)
- AmbientLight glow (placed on scene, visible to all)
- Configurable colors via settings

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
