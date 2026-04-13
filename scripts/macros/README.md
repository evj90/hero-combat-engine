# Macro Scripts Folder

Drop custom macro script modules here, then run:

```bash
node tools/build-macro-registry.mjs
```

The generator updates `scripts/macro-registry.generated.js` with static imports for all `.js` files under this folder.

## Export Contract

Each macro module should export one of these:

- `run(...args)`
- `default (...args)`
- `execute(...args)`

## Example

```js
export async function run() {
  ui.notifications.info("My macro ran.");
}
```

After rebuilding, the module is available in Foundry as:

- `game.heroCombat.macros["my-file"]` (the module object)
- `await game.heroCombat.runRegisteredMacro("my-file")`
- `game.heroCombat.openRegisteredMacroDialog()` (one-click picker dialog)

For nested files, use slash names (example `control/end-turn`).

## Compendium Launcher Macro

The bundled compendium includes a launcher macro named **Run Registered HERO Macro**.
Run that macro to pick and execute any registered script without writing individual wrapper commands.
