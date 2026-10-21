# Plan: 13 Configuration folder sync

Ticket: `.scratch/vault-sync-impl/issues/13-configuration-folder-sync.md`
Parent spec: `.scratch/vault-sync/spec.md`, "Synced file scope" (configuration folder), "First sync", "Notices"
Branch: `feat/config-sync` (new, from `origin/main` at `c552206`, which has ticket 12)
Status: plan and decisions approved 2026-10-21; Remote name `.obsidian-config`; manual check postponed

## Facts checked

- **The configuration folder is already listed.** `ObsidianLocalVault.list` (`src/obsidian/local-vault.ts`) walks `vault.configDir` through `adapter.list` on every call, and every sync (polls included) calls `vault.list()`. `stat`, `read`, `write`, `replace`, `createFolder`, `trash` and `rename` already go through the adapter for paths in it. `FakeVault` lists it too, with the deliberately unusual name `.vault-config`. So the ticket's "scanned through the adapter on every poll" holds today; what is missing is that `syncListing` drops it.
- **Where it is dropped.** `syncListing` (`src/engine/sync-listing.ts`) leaves out every hidden path and, by its own rule, everything within `configDir` on both sides, "until its categories exist".
- **The name is not promised.** `Vault.configDir` is documented as "typically `.obsidian` but it could be different" (`obsidian.d.ts`). Obsidian's help ("Configuration folder") says the override name should start with a period, and that settings do not move to a new folder.
- **This plugin's own folder.** `PluginManifest.dir` is the "Vault path to the plugin folder in the config directory" (`obsidian.d.ts`), optional in the typings.
- **What the folder holds** (Obsidian help, "How Obsidian stores data" and "Sync settings and selective syncing"): hotkeys, themes, community plugins; `workspace.json` and `workspaces.json` "store the current workspace layout". Obsidian Sync splits the folder into main settings, appearance, themes and snippets, hotkeys, active core plugin list, core plugin settings, active community plugin list, installed community plugins. `workspace-mobile.json` is the mobile layout file (forum sources only, no official page).
- **Restart.** The same help page: hotkeys, appearance and core plugin settings hot-reload; CSS (themes, snippets), graph settings and core plugin on/off need a reload; community plugins usually need a restart. `Plugin.onExternalSettingsChange` exists, but the spec says other plugins are not reloaded.
- **Conflicts today.** A both-sides change of JSON that does not merge cleanly, or of any non-text file, becomes a Conflict copy next to the file (`keepConflictCopy` in `sync-run.ts`), and a rename onto an occupied path makes one too (`carry-renames.ts`). Inside the configuration folder that would leave stray files in `plugins/` or `snippets/`.
- **Not in this ticket:** the Sync window with its Conflicts tab (ticket 14), help texts (ticket 16).

## Decisions

### Categories: which file goes where

Paths are relative to `configDir`. Every category is off by default, per device.

| Category | Paths |
|---|---|
| Settings and hotkeys | every file directly in the folder not named below: `app.json`, `hotkeys.json`, `core-plugins.json`, the core plugin settings (`daily-notes.json`, `graph.json`, `types.json`, …) |
| Themes and snippets | `themes/**`, `snippets/**`, `appearance.json` (it names the chosen theme and the enabled snippets, so the theme alone would not apply without it) |
| Plugins | `plugins/**`, `community-plugins.json` (the list of enabled plugins) |
| Never | `workspace.json`, `workspace-mobile.json`, `workspaces.json`, this plugin's own folder (`manifest.dir`) and `plugins/<manifest.id>`, any other subfolder (unknown content), and any path inside with a segment starting with a dot |

The folder itself and `plugins/`, `themes/`, `snippets/` sync as folders while a category that holds something in them is on.

### One name on the Remote

The folder is stored on the Remote as `.obsidian-config` and mapped to each device's `configDir`: `.obsidian-mobile/app.json` here is `.obsidian-config/app.json` there. Changed during step 1 (2026-10-21, your choice): `.obsidian` was planned, but the community ruleset's `obsidianmd/hardcoded-config-path` refuses that literal anywhere in plugin code and `eslint-comments/no-restricted-disable` forbids switching it off. The mapping joins the name-policy codec (`src/engine/name-policy.ts`), so the sync still works in vault paths only. The two names are swapped both ways, so the mapping stays reversible: a Remote folder carrying this device's `configDir` name reads as the shared name, a hidden path the device never lists, and stays left out.

### Switching per device

- Categories are a device setting in Obsidian's per-vault localStorage, like the schedule (`src/obsidian/schedule-store.ts`), read by the engine at the start of every sync through a new port value.
- **Off:** the category's paths are left out on both sides, unreported, and their Sync snapshot entries are forgotten at the start of the sync, so the snapshot holds none of them and nothing is ever taken for a deletion.
- **On:** with no snapshot entries, the category's files go through the union a First sync does: only here → upload, only there → download, both with the same content → recorded, both different → a configuration conflict (below). Nothing is deleted. There is **no preview** for this: a configuration conflict loses nothing (the local version is kept), so the preview's choice between merging and "keep Remote" has nothing to decide. Turning a category on in settings starts a sync at once.
- **Plugins** gets a warning in its settings row: other plugins' settings (`data.json`) may hold secrets such as API keys, and they are copied to the Remote.

### Configuration conflicts

- A file in the configuration folder changed on both sides is merged only when the result is clean (no Conflict blocks) and, for JSON, parses. Conflict blocks are never written into configuration files, whatever the text-extension list says.
- Otherwise the **Remote version wins**: it is written over the local file, and the local version is kept in this plugin's folder, `<manifest.dir>/configuration-conflicts/`, one entry per conflict (path, time, bytes), so a second conflict on the same file does not replace the first. A rename onto an occupied configuration path does the same instead of making a Conflict copy.
- Behind a new port, `ConfigurationConflictStore` (keep, list, read, remove), with an in-memory fake for tests; the Obsidian adapter writes through `vault.adapter` into the plugin folder, which never syncs.
- **Restore local:** an engine call writes a kept version back over the configuration file and removes it from the list; the next sync uploads it as a local edit.
- The First sync preview gets an outcome for differing configuration files: "Remote kept, yours restorable".
- `UiPort.showConfigurationConflicts(list)` passes the restorable list on each sync, as `showSkipped` does.

### Restart notice

A new `SyncNotice` kind, `configurationChanged`, shown once per sync when the sync wrote, merged, replaced, trashed or renamed anything in the configuration folder: "Settings changed on another device. Restart Obsidian to apply them." Other plugins are not reloaded.

### Shell until ticket 14

- Settings tab: three toggles with descriptions, Plugins with the secrets warning, in English and Russian.
- A command "Restore local configuration…" opens a list (`SuggestModal`) of the kept versions, newest first; picking one restores it. Ticket 14's Conflicts tab will list them too and replace nothing of this logic.

## Test seams

1. Pure module `src/engine/configuration.ts`: the category of every kind of path (each table row, nested dot segments, the own folder under another `configDir`), and the Remote name mapping both ways.
2. The sync engine through its ports (spec seam 1), two or more devices on one FakeRemote, with different `configDir` names: categories off sync nothing and leave nothing in the snapshot; one device with a category on shares it with another; per-device categories (phone with themes only); workspace files and the own folder never sync; turning a category on unions both sides without deleting; turning it off and on again; a JSON conflict that merges cleanly; one that does not, and a CSS one: Remote kept, local listed, Restore local uploads it; a rename onto an occupied configuration path; the restart notice; the First sync preview outcome.
3. Shell text: restart notice, preview outcome, category rows and warning, restore list, in EN and RU.
4. Manual (you, in Obsidian): how Obsidian reacts when synced configuration files change on disk while it runs (hotkeys, a snippet, a plugin's `data.json`, `community-plugins.json`); the results go into the ticket.

## Steps

- [x] 1. `configuration.ts`: categories, the never-synced paths, the Remote name mapping (seam 1).
- [x] 2. Engine: the mapping in the path codec, the categories port and the listing exception, forgetting off-category entries, union on turning on (seam 2). The shell passes all categories off until step 5 adds the store.
- [x] 3. Engine: configuration conflicts, the `ConfigurationConflictStore` port and its fake, Restore local, rename onto an occupied path, the preview outcome, `showConfigurationConflicts` (seam 2). Changed during step 3 (2026-10-21): the Obsidian store for kept versions (`src/obsidian/`, over the vault adapter, tested against an in-memory adapter) and the status indicator keeping the list move here from step 5, because the engine's new required ports must be wired for the plugin to compile at the end of this step. For the same reason the preview text of the new outcome and the click notice's line on kept versions (EN/RU) came here too.
- [x] 4. Engine: the `configurationChanged` notice (seam 2). Its EN/RU text came with it, since the shell's notice switch must cover every kind to compile.
- [x] 5. Shell: category store and toggles with the warning, sync on turning on, the restore command, EN/RU (seam 3).
- [x] 6. Postponed by choice 2026-10-21: the manual check in Obsidian (you) needs a build of this branch with the real Dropbox key, so it is noted on the ticket as still to check by hand.
- [x] 7. Close ticket 13 in the feature commit itself; note for ticket 14 (the Conflicts tab and kept versions).
- [x] 8. Full test run, typecheck, lint, build with a stand-in key; one code review at the end.
- [x] 9. Review fixes chosen 2026-10-21 (findings 1, 2, 3, 4, 5, 7, 8, 9, 10; 6 left as it is), each test first:
  - [x] 9.1 A configuration file renamed onto a path the Remote holds deletes its old Remote file only while that file's revision is still the snapshot's; an edit there downloads back.
  - [x] 9.2 Restore local is queued and applied inside the next sync run, before listing.
  - [x] 9.3 The Obsidian store keeps each version as `<id>.json` and `<id>`, with no shared index; an unreadable version is skipped, never the others.
  - [x] 9.4 `plugins/<manifest id>` never syncs, as well as this device's own plugin folder.
  - [x] 9.5 The typing pause is checked before the local version is kept.
  - [x] 9.6 The restore command catches and logs a failure.
  - [x] 9.7 One shared helper wraps the vault's writing methods, for both vault proxies.
  - [x] 9.8 The test helper `writeVaultFile` uses `ensureVaultFolder`.
- [x] 10. Full test run, typecheck, lint and build again after the fixes.
