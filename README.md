# Angler Mod Manager Electron

Standalone Electron mod manager for COTW-TA
## Commands

```bash
npm install
npm run dev
npm run dist:win
```

## Behavior

- Drop mod folders or `.zip` files into the app.
- Imported mods are stored in the app's user data library.
- Enabled mods are copied into the selected game folder's `mods` directory.
- If the Steam install is detected, the `mods` folder is created automatically.
- Toggling a mod on or off applies the enabled set automatically when the game folder is known.
- Files deployed by the manager are tracked and cleaned up on the next apply.
- `Apply & Play` applies enabled mods, then launches Steam app `1408610`.

The game still needs this Steam launch option:

```text
--vfs-fs mods --vfs-archive archives_win64
```
