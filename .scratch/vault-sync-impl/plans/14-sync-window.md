# Plan: 14 Sync window, notices and reconnect

Ticket: `.scratch/vault-sync-impl/issues/14-sync-window-notices-and-reconnect.md`
Parent spec: `.scratch/vault-sync/spec.md`, "Status, notices, guidance" (stories 88–96, 98)
Branch: `feat/sync-window` (new, from `origin/main` at `beaf0d2`, which has ticket 13)
Status: plan and decisions approved 2026-10-21

## Facts checked

- **Entry points today.** `StatusIndicator` (`src/ui/status-indicator.ts`) is the shell's `UiPort`: a status bar item on desktop, a ribbon icon (`cloud-off`, never changed) on mobile, with the skipped count after the label. A click shows everything in one `Notice` "until the Sync window exists".
- **Ribbon at runtime.** `addRibbonIcon` returns the icon's `HTMLElement`, and `setIcon(el, iconId)` redraws an element's icon (`obsidian.d.ts` 1.14.4). Nothing in the typings or docs says whether Obsidian mobile shows a changed icon (the mobile ribbon may be drawn from the icon id given at registration). Only a run on a phone can tell.
- **Statuses.** `SyncStatus` (`src/engine/status.ts`) has `notConnected`, `connected`, `syncing`, `synced`, `offline`, `syncFailed`, `deletionsOnHold`, `firstSyncWaiting`. `syncFailed` "stands in for Reconnect needed until that exists".
- **`auth` today.** `engine.ts` `syncOnce` shows `syncFailed` for an `auth` failure and for a Connection without its secret, and retries on the next trigger, so every poll fails again. Dropbox maps 401 and a refused refresh token (`invalid_grant`) to `auth` (`src/providers/dropbox/errors.ts`, `client.ts`).
- **Reconnect today.** `ConnectionService` already handles a login to the same account: `reconnected` replaces the secret and keeps the Connection, Snapshot and Bases (`src/engine/connection.ts`). But the settings tab offers Connect only without a Connection, so a connected device has no way to log in again.
- **Notices.** `SyncNotice` (`src/engine/notices.ts`) already has every kind the ticket names except reconnect: `restoredAfterDelete`, `renamedOnBoth` (spec: "two different renames: the Remote name wins, with a notice naming both" = "renamed to the Remote name"), `configurationChanged`, `conflictCopyCreated`; plus `renameBeatsDelete` and `firstSyncDone`. Nothing keeps them after the notice fades.
- **Conflicts known today.** Kept configuration versions reach the shell through `UiPort.showConfigurationConflicts`. Conflict copies are recognisable by name only (`isConflictCopy`, `src/engine/conflict-copy.ts`). Nothing tracks which files hold Conflict blocks; `recordFile` in `sync-run.ts` is the one place a synced file and its Base are recorded, and a text file's Base is exactly its synced content.
- **Phones.** Only the editor's conflict action row has 44 px buttons (`obsync-phone` class, `styles.css`). The connect, Deletion guard, First sync and hand-edit modals do not.
- **Shell tests** cover only pure text functions (`test/ui/*`); there is no DOM test environment.

## Decisions (my recommendations)

### Reconnect needed

- New status `reconnectNeeded`, label "Reconnect needed".
- An `auth` failure, or a Connection whose secret is gone, **pauses** sync on this device: the engine stores `reconnectNeeded: true` in the Connection, shows the new notice kind `reconnectNeeded` once, and shows the status. Stored, so a restart neither syncs nor notifies again.
- While paused, every trigger (polls, edits, visibility, online, and "Sync now") only shows the status; nothing reaches the provider. Other devices are untouched.
- Reconnecting with the same account (`reconnected`) clears the flag; the shell then starts a sync at once, a normal one, since the Snapshot and Bases were kept. Another account stays refused as today.
- The Sync window shows "Reconnect" instead of "Sync now" while paused, and a "Reconnect to Dropbox" command is available only then. Both open the existing connect window.

### Conflicts

- The snapshot entry of a file gets an optional `conflicted: true` when its synced content holds Conflict blocks, set in `recordFile` (absent means none, like the existing optional `size`). A rename keeps it with the entry. Resolving the blocks changes the file, the next sync records it again and the flag goes.
- New pure function: the conflicts of a snapshot: files with Conflict blocks, Conflict copies (snapshot paths that `isConflictCopy`), and kept configuration versions.
- `UiPort.showConflicts(conflicts)` replaces `showConfigurationConflicts`: reported when the engine starts (from the stored snapshot, so the count shows before the first sync), after every completed or held sync and every restore; emptied on disconnect, like the skipped list.
- The conflict count is the total of the three lists.

### Activity log

- Engine module `activity-log.ts`: the last **100** events, newest first, each with its time. Events: every notice; every status change except into `syncing`, logged only when it differs from the last logged one (so polls do not flood it); `syncFailed` now carries its cause (a provider failure category, unsupported provider, unreadable shared settings, or a bug).
- Recorded by a `UiPort` wrapper from the same module, wired in `main.ts` around the shell's UI port and given to both the engine and the connection service, so no notice or status can bypass the log.
- Kept per device across restarts behind a new `ActivityStore` port, in Obsidian's per-vault localStorage (like the schedule store); kept on disconnect.

### Shell

- **Status bar (desktop):** a coloured dot, the label, then counts only when non-zero: "● Synced · 2 conflicts · 3 skipped".
- **Ribbon (mobile):** the tooltip as the status bar text, and an icon per state through `setIcon` (`cloud` synced, `refresh-cw` syncing, `cloud-off` offline / not connected, `log-in` reconnect needed, `pause` held, `alert-triangle` failed), checked on Android and iOS; if a phone does not show the change, the icon switching is removed and the result noted on the ticket.
- **Labels:** `deletionsOnHold` becomes "Paused (confirm deletions)" as the ticket names it; the others stay.
- **Sync window:** a `Modal` opened by the status bar item, the ribbon icon and a command. Top: dot, state, "Sync now" or "Reconnect". Tabs:
  - Conflicts: files with Conflict blocks (opens the note with the cursor on its first block), Conflict copies (opens the copy), kept configuration versions with "Restore local" each;
  - Skipped: every file with its reason;
  - Activity: the events in plain words with their local time, and "Copy for a bug report".
  The window redraws while open as the engine reports.
- **Bug report:** always in English, since it is for the developer: plugin version, Obsidian version, platform, state, counts, then the events. It contains file paths; the Activity tab says so next to the button.
- **Commands** (Obsidian shows them as "Obsync: …"): Open sync window, Show conflicts, Show skipped files, Show activity, Reconnect to Dropbox (only while paused), plus the existing Sync now, Full reconcile, Restore local configuration, Next/Previous conflict.
- **44 px on phones:** one shared helper marks every modal of the plugin on a phone (`obsync-phone`), and the stylesheet gives its buttons `min-height: 44px`.
- **All new texts** in EN and RU.

### Out of scope

Help and onboarding (ticket 16); a Reconnect row in the settings tab; per-sync upload/download counts in the activity log.

## Test seams

1. Engine through its ports (multi-device, FakeProvider): `auth` pauses one device only, one notice, flag stored, no provider calls on any trigger, restart keeps the pause silently; missing secret pauses the same way; reconnect to the same account clears it and the next sync is normal (no First sync preview); another account is refused and stays paused.
2. Engine: conflicts reported at start, after a sync that merged with blocks here, after downloading a file with blocks from another device, cleared after the blocks are resolved and synced, kept after a rename; Conflict copies; kept versions after a restore; emptied on disconnect.
3. Activity log: notices and status changes recorded with times, `syncing` and repeats left out, failure causes, cap of 100, newest first, kept through its store; the Obsidian store's stored/storable record helpers.
4. Device store records: the parse of a Connection with the flag and of a snapshot entry with `conflicted` (the two parsers exported, as the schedule store's are).
5. Shell text in EN and RU: status labels, the status bar text with counts, activity lines for every event kind, the bug report, the conflict list lines, notice text for `reconnectNeeded`.
6. Not unit-tested, for lack of a DOM environment: the Sync window, entry points and modal classes; covered by the manual check.
7. Manual (you): desktop, Android, iOS: entry points and states, the window and tabs, opening at the first block, Restore local, Copy for a bug report, 44 px buttons, an expired login and Reconnect, whether the ribbon icon changes.

## Steps

- [x] 1. Branch `feat/sync-window` from `origin/main`; `pnpm install`.
- [x] 2. Reconnect needed: status, Connection flag and its parse, notice kind, pause in the engine, clearing on reconnect, sync after reconnect, EN/RU label and notice (seams 1, 4, 5).
- [x] 3. Conflicts: snapshot flag and its parse, conflicts function, `showConflicts` replacing `showConfigurationConflicts`, reports at start, after syncs and restores, on disconnect (seams 2, 4).
- [x] 4. Activity log: module, wrapper, `syncFailed` causes, `ActivityStore` port with fake and Obsidian store (seam 3).
- [x] 5. Shell text: status bar text with counts, activity lines, bug report, conflict lines, labels, EN/RU (seam 5). The conflict lines need no function of their own: files and copies are shown by path, kept versions by the existing `keptConfigurationItem`. The failure texts are whole sentences ("Sync failed. Dropbox is full."), since the sentence-case lint rule refuses strings that start in lower case.
- [x] 6. Shell UI: Sync window, entry points with dot and ribbon icon, commands, 44 px modals, the click notice removed. Its kept-versions line (`keptConfigurationLine`) went with it. Only one Sync window is open at a time, and it closes when the plugin unloads.
- [x] 7. Postponed by choice 2026-10-21: the manual check in Obsidian (you) needs a build of this branch with the real Dropbox key, so it is noted on the ticket as still to check by hand, including whether the ribbon icon changes on Android and iOS.
- [x] 8. Close ticket 14 in the feature commit itself; full test run, typecheck, lint, build with a stand-in key; one code review at the end. The review's findings 1–6, 8 and 9 were fixed by choice; 7 (not reachable) and 10 (parsers exported as the plan says) were left.
