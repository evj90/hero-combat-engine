# HERO Combat Engine — Changelog

## v1.1.0

### Added
- Quick status toggle strip per combatant (Stunned, Prone, Restrained, Blind, Deaf, Unconscious) with icons sourced from `CONFIG.statusEffects`
- PIXI starburst burst animation for acting tokens (local canvas, no scene documents)
- AmbientLight pulsing glow for the currently acting token (GM-created, visible to all)
- New settings: Glow Bright Radius, Glow Dim Radius, Glow Intensity
- PRE stat pip bar (optional, controlled by `showPreBar` world setting)
- `clearHighlights()` exposed on `game.heroCombat`
- Stale token warning banner in the combat panel
- "No tokens act this segment" message when the acting-only filter empties the list

### Changed
- Highlight system fully rewritten — replaces Drawing document rings with PIXI graphics and AmbientLight
- Settings menu fieldset renamed to "Highlight Appearance"; glow fields added
- Combatant row restructured to `flexcol` — stat bars to the right of the token name, action buttons in a full-width bottom row
- All action buttons visible at rest (opacity 0.6) instead of hidden until hover
- Segment header title always "HERO Combat Engine" (removed dynamic segment readout from title bar)
- SPD acting bar simplified to plain text with a green left accent border
- Show All / Acting Only toggle moved into the segment header nav bar (icon only)
- End Turn and Take Recovery buttons use green hover to signal primary action
- Status toggle active state uses amber instead of red
- Acting token's portrait image gets an orange border and glow
- Segment title uses uppercase + letter-spacing
- Stat labels use a fixed width (26px) to prevent layout shift when PRE is toggled
- Stale token warning text shortened
- History squashed to a single root commit

### Fixed
- Removed stale `notifyTokenOwner` call from `highlight.js`
- "No combat in progress" shown on segments where no one acts — now shows correct message based on filter state

## v1.0.1

### Added
- Phase and Segment display in panel title (Phase first, then Segment)
- Phase and Segment context in all chat messages
- Begin Combat button to start a new HERO combat session
- Add Selected Tokens button to add tokens mid-combat
- Temporary highlight effect (5-second ring) for all acting tokens
- Red-tinted highlight for dead/unconscious characters
- First-acting-token announcement when segment advances
- Controller panel for turn-by-turn token management
- Debug mode toggle in module settings (disable for cleaner chat)
- `game.heroCombat` API exposed with core functions

### Fixed
- Module import ordering to ensure `game.heroCombat` initialization
- Duplicate variable declarations in token addition logic
- Scene flag preservation before cleanup on combat end
- Highlight rings now clear automatically after temporary display

### Changed
- Highlight button now shows temporary visual effect instead of persistent rings
- Chat messages now consistently include Phase and Segment context
- Debug chat messages styled and configurable

## v1.0.0 (Initial Release)

### Features
- HERO System 12-segment combat timing engine
- Custom floating UI panel with segment/phase display
- Token highlighting based on SPD chart
- Scene-flag based timing state (no Foundry combat tracker dependency)
- Modular architecture for easy extension
- Full debug logging to browser console and chat
