# HERO Combat Engine

An unofficial Foundry VTT v11 module for running HERO System combat with a 12-segment, phase-based tracker instead of Foundry's standard turn order.

The module keeps combat state on scene flags, provides a floating controller panel for the table, and adds HERO-specific tools like Hold, Abort, pip-based stat bars, and segment-aware token highlighting.

> HERO System is a trademark of HERO Games. This module is not affiliated with or endorsed by HERO Games.

![HERO Combat Engine panel](images/screenshot_panel.png)

## What It Does

- Replaces normal initiative flow with HERO segment and phase timing.
- Sorts combatants by DEX, with configurable END or EGO tie-breaks.
- Shows a floating tracker with the current segment, acting token, and full combat order.
- Highlights acting tokens with burst and glow effects across clients.
- Supports Hold, Release Hold, Abort, recovery shortcuts, and segment stepping.
- Displays pip-style STUN, BODY, END, and optional PRE status bars.
- Tracks quick conditions and combat state directly from the panel.
- Lets the GM begin combat from selected tokens, add or remove tokens mid-fight, and refresh order after stat changes.

## Requirements

- Foundry Virtual Tabletop v11
- A HERO System world or actor data model that exposes HERO-style characteristics such as SPD, DEX, STUN, BODY, END, OCV, DCV, and MCV

## Installation

Install through Foundry using this manifest URL:

```text
https://raw.githubusercontent.com/evj90/hero-combat-engine/main/module.json
```

Direct download:

```text
https://github.com/evj90/hero-combat-engine/archive/refs/heads/main.zip
```

## Quick Start

1. Enable the module in your world.
2. Place or select the tokens you want in combat.
3. Open the HERO Combat panel from the scene controls.
4. Click **Begin** to build the combat order from the selected tokens.
5. Use the token and segment navigation controls to run the encounter.
6. Click **End** when combat is over to clear combat state and close the tracker.

## Panel Workflow

### Top Navigation

- **Previous Segment / Next Segment** steps backward or forward through HERO timing.
- **Previous Token / Next Token** moves within the current segment's acting order.
- **Hide Non-Acting** toggles a filtered view so only relevant tokens remain visible.

### GM Controls

- **Begin** starts a combat from selected tokens.
- **Add** adds currently selected tokens to the active combat.
- **Remove** removes currently selected tokens from the active combat.
- **Acting** re-highlights the currently acting token.
- **Refresh** rebuilds and re-sorts combat order using current stats.
- **End** clears combat state and shuts the encounter down.

### Per-Combatant Controls

- **Ping** and **Pan** jump the table to a token quickly.
- **Cover** cycles temporary DCV bonus stages, with right-click direct set.
- **OCV Bonus** cycles temporary OCV bonus stages, with right-click direct set.
- **Hold** removes a token from its current place so it can act later in the segment.
- **Release Hold** inserts that held token immediately after the current acting token.
- **Abort** marks a token as aborting before it acts.
- **Recovery** takes recovery and ends the token's turn.
- **Done** ends the token's turn normally.
- **Remove from Combat** removes that token from the encounter.

## Tracker Features

### Combat Readout

- Current segment display in `phase.segment` format.
- SPD values acting in the current segment.
- Combatants sorted in HERO-friendly order.
- Optional SPD column in the tracker.
- Stale-token warning when stored combatants no longer exist on the canvas.

### Stat and Value Display

- Pip bars for tracked characteristics, defaulting to STUN, BODY, and END.
- Optional PRE tracking by adding it to the tracked pip characteristics setting.
- Combat value rows are configurable (default OCV, DCV, MCV).
- Temporary combat value modifiers can target any configured combat-value stat.
- Color-coded thresholds for Full, Less, Half, Hurt, Risk, and Out states.
- Accessibility sizing options for larger text and hit areas.

### Status and Adjustment Tools

- Quick status toggles for Flashed (Sight), Flashed (Hearing), and Entangled/Restrained.
- Prone is shown when active so it can be managed from the tracker.
- Cover tracking with one-click DCV stage changes.
- OCV bonus tracking with one-click stage changes.
- Drain and Aid badges tracked from the panel.
- Entangle BODY tracking when present on the token.
- Extra active effects displayed as icons in the row.

## Settings Highlights

The settings menu covers four main areas:

- **Tracker behavior**: auto-open for players, auto-close on combat end, SPD column visibility, tracked pip characteristics, combat value characteristics, hide non-acting tokens, and accessibility sizing.
- **Turn management**: player turn-ending permissions, skip warnings (including held-token loss warnings), automatic empty-segment skipping, incapacitated-token skipping, and DEX tie-break behavior.
- **Visuals**: active highlight colors, incapacitated colors, burst settings, ring width, inset, glow radius, and glow intensity.
- **Recovery and chat output**: token turn messages, segment summaries, skipped segment notices, post-segment 12 recovery messages, and configurable STUN/BODY recovery thresholds.

## Usage Notes

- This module does not rely on Foundry's normal combat turn order for timing; HERO timing is managed separately.
- Do not run the built-in Foundry combat tracker in parallel with this module. Foundry's tracker assumes one linear initiative order, while HERO Combat Engine manages segment, phase, Hold, Abort, and acting-order state independently on scene flags. Using both at once can leave the visible tracker, active token, and actual HERO timing out of sync.
- Combat state is stored on the current scene, so changing scenes changes the active combat context.
- If token stats change during combat, use **Refresh** to rebuild order from current values.
- Depending on hosting, the toolbar button image can appear a few seconds after page load. On The Forge, CDN asset loading can delay that icon on first load.

## Included Content

- Floating HERO combat controller panel
- Highlight and segment timing engine
- Settings menu for tracker, chat, recovery, and visuals
- Bundled macro compendium for common combat actions

## Version

Current module version: `1.1.0`



