# Synced file scope

Type: grilling
Status: resolved
Blocked by: 02, 17

## Question

Which files does the plugin sync? Decide whether the vault configuration folder (`.obsidian/`: settings, plugins, themes, workspace layout) is synced in whole, in part or not at all, and how per-device files (e.g. workspace layout) are kept apart; the default ignore list and how the user edits it; that the plugin's own state never syncs; hidden files; and whether there is a file size ceiling. Depends on what the API can see, per [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md). Each provider reports its maximum file size, and transfers are whole buffers held in memory ([Provider contract](05-provider-contract.md)).

Per [Mobile runtime checks](17-mobile-runtime-checks.md), whole files up to 100 MB were handled in memory on Android and iOS, and every HTTP request stays below a per-request limit (under 20 MB by default, user-configurable), so the file size ceiling is not bound by a single request.

## Answer

Decided in a grilling session.

1. **Synced:** every visible file and folder of the vault, except what the ignore list or the size ceiling excludes.
2. **Hidden paths** (any path segment starting with a dot: `.git`, `.trash`, `.DS_Store`, …) are never synced, with one exception: the configuration folder, per point 3.
3. **Configuration folder (`vault.configDir`).**
   - **Categories, all off by default:**
     - settings and hotkeys;
     - themes and snippets;
     - plugins: code (`main.js`, `manifest.json`, `styles.css`) and their `data.json`. Turning this category on warns that other plugins' settings can hold secrets.
   - **Per-device switches.** A category that is off on a device is neither uploaded nor applied there and stays out of that device's Sync snapshot, so it never causes deletions. Turning a category on behaves like a First sync for its files: union, with a preview.
   - **Always excluded:** workspace layout files (per device) and the sync plugin's own folder. The plugin's own state (Sync snapshot, Base) never syncs, and secrets live in `SecretStorage`.
   - **One fixed name on the Remote.** The configuration is stored under a fixed name, with the exact name left to the spec, and each device maps it to its own `vault.configDir`. Devices whose config folders are named differently therefore share one configuration.
   - **Found by scanning.** Hidden paths produce no vault events, so the folder is scanned through the adapter on every poll, per [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md).
4. **Configuration changes arriving while Obsidian runs** are written to disk, and the user sees "Settings updated, restart Obsidian to apply". The plugin does not reload other plugins or settings itself. How Obsidian reacts to configuration files changing on disk while it runs is unverified and is recorded as a risk for the spec.
5. **Configuration conflicts.** When a clean merge does not give valid JSON, the Remote version goes into the file and the local version is kept in the sync plugin's own folder, where it is never synced. It can be restored from the conflict list, and the user is notified. A Conflict copy next to the file would sit inside a hidden folder, out of the user's sight.
6. **Ignore list:** editable path patterns in the shared Remote settings, identical on every device. It is empty by default; the fixed rules of points 2–3 apply regardless. Per-device exclusions (selective sync) are out of scope for this map.
7. **File size ceiling:** 100 MB by default, never above the provider's maximum. It is a shared Remote setting, editable by the user. Larger files are skipped and listed for the user. 100 MB is the size handled in memory on Android and iOS in [Mobile runtime checks](17-mobile-runtime-checks.md); each HTTP request stays under that ticket's per-request limit.
