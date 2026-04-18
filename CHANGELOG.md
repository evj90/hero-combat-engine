# HERO Combat Engine — Changelog

## v1.1.0

### Features
- HERO System 12-segment combat timing engine with phase tracking
- Custom floating controller panel with segment/phase display and full combat order
- Token highlighting with PIXI starburst burst and AmbientLight pulsing glow
- Configurable highlight colors, burst settings, ring width, inset, glow radius, and intensity
- Incapacitated token color differentiation
- Scene-flag based timing state (no Foundry combat tracker dependency)
- Combatants sorted by DEX with configurable END or EGO tie-breaks
- Hold, Release Hold, and Abort actions
- Recovery shortcut that ends the token's turn
- Begin Combat from selected tokens, Add/Remove tokens mid-fight, Refresh order after stat changes
- Pip-style stat bars for STUN, BODY, END, and optional PRE
- Color-coded thresholds: Full, Less, Half, Hurt, Risk, and Out
- Combat value rows for OCV, DCV, MCV with temporary modifier tracking
- Temporary combat value modifier dialog with per-modifier Edit, Remove, and Clear All controls
- Cover (DCV), OCV bonus, and MCV bonus stage cycling with right-click direct set
- Quick status toggles: Flashed (Sight), Flashed (Hearing), Prone, Entangled/Restrained
- Drain and Aid tracking with configurable fade rate per segment or phase
- Drain/Aid fade restores affected characteristics point-for-point
- Entangle BODY tracking
- Flash Points tracking with automatic segment-based recovery
- Stale-token warning banner in the combat panel
- Automatic empty-segment skipping with optional chat notices
- Incapacitated-token skipping
- Post-segment 12 automatic recovery
- Player turn-ending permissions with configurable self-advance
- Socket-based actions for non-GM players
- Ping (bypasses Foundry permission check) and Pan To controls per combatant
- Panel auto-renders on actor, token, and scene flag changes for immediate modifier refresh
- Hide Non-Acting toggle for filtered view
- Accessibility sizing options (compact, medium, large)
- Semantic ARIA attributes and right-click indicator dots
- Non-GM players see contextual messaging instead of disabled buttons
- SPD column visibility toggle
- Live preview for tracked pip and combat value characteristic settings
- Bundled macro compendium with individual entries for each registered macro
- Macro registry build tool for source-controlled macro development
- Mental Illusion Attack macro
- Modular architecture for extension

### Macro Compendium
- Full Health
- Grapple (STR contest with squeeze, throw, pin, drag, break free)
- Recover
- Remove Status Effects
- Rotate CW
- Set Upright
- Run Registered HERO Macro (pick-from-list launcher)
- Begin/End HERO Combat, Advance Segment, Highlight Acting, Next/Previous Acting Token
