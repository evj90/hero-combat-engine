HERO Combat Engine — System Overview for Developers
The HERO Combat Engine is a Foundry VTT module that replaces the built‑in combat flow with a HERO System–accurate segment/phase engine. It provides a custom UI panel, timing logic, and token‑highlighting behavior that mirrors HERO’s 12‑segment turn structure.
The module is intentionally modular and split into separate files so that each subsystem can be extended independently.

🗂️ Module Architecture
1. main.js — Module Entry Point
- Registers Foundry hooks
- Adds a sidebar button to open the HERO Combat Panel
- Exposes global API under game.heroCombat
- Loads all subsystem modules
This is the module’s “bootstrap” file.

2. hero-panel.js — Floating UI Panel
A custom Application subclass that displays:
- Current segment
- Current phase
- Buttons for advancing segments
- Buttons for highlighting acting tokens
- Buttons for ending combat
This panel is the primary user interface for the HERO timing engine.

3. segment-engine.js — HERO Timing Logic
Implements the HERO System’s 12‑segment turn structure.
Responsibilities:
- Track segment and phase using scene flags
- Advance segment/phase
- Broadcast updates to chat
- Provide API functions for other modules
This file is the “brain” of the timing system.

4. spd-map.js — SPD → Segment Lookup Table
Defines the HERO System SPD chart:
- SPD 1–12
- Which segments each SPD acts on
Used by the highlight system and any future automation.

5. highlight.js — Acting Token Highlighter
Determines which tokens act in the current segment:
- Reads SPD from actor data
- Compares against SPD map
- Sorts by DEX
- Draws green rings around acting tokens
- Clears old rings
This is the visual component of the timing engine.

6. begin-combat.js — Hybrid Combat Initialization
Creates a Foundry combat encounter but delegates timing to the HERO engine.
Responsibilities:
- Delete existing combats
- Create a new combat
- Add selected tokens
- Initialize segment/phase to 1/1
- Announce participants in chat
This ensures game.combat exists without using Foundry’s turn order.

7. end-combat.js — Cleanup
Safely resets the world:
- Deletes combat encounters
- Clears highlight rings
- Clears HERO timing flags
- Announces end of combat

8. templates/panel.html — UI Template
HTML template for the floating HERO panel.

9. styles/hero-panel.css — UI Styling
CSS for the HERO panel.

🎯 Design Goals (for future developers)
- Replace Foundry’s turn order with HERO’s segment/phase system
- Provide a clean, modular architecture
- Keep UI and logic separate
- Expose a stable API under game.heroCombat
- Avoid modifying Foundry’s built‑in combat tracker
- Allow future expansion (SPD automation, recovery, held actions, etc.)

🔧 Extension Points for Future Development
A developer can safely extend the system by modifying or adding:
✔ New UI elements
Add buttons or displays to hero-panel.js and panel.html.
✔ New timing rules
Modify segment-engine.js.
✔ New highlight logic
Extend highlight.js to support:
- Held actions
- Abort actions
- Post‑12 recovery
- Flashing indicators
✔ New automation
Add files like:
- recovery.js
- held-actions.js
- dex-order.js
✔ New settings
Add a settings.js file and register module settings.

🧠 How to Tell GitHub Copilot to Work on This Module
Use this description:
“This repository contains a Foundry VTT module called HERO Combat Engine. It replaces the built‑in combat flow with a HERO System segment/phase engine. The architecture is modular: main.js loads the module and registers hooks; hero-panel.js defines a custom Application UI; segment-engine.js manages HERO timing; highlight.js highlights acting tokens; begin-combat.js and end-combat.js manage combat lifecycle; spd-map.js defines the SPD chart. All logic is exposed under game.heroCombat. Continue development by adding new features in separate files, keeping UI and logic separated, and extending the timing engine cleanly.”
