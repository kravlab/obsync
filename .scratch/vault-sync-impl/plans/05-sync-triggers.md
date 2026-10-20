# Plan: 05 Sync triggers and interruption safety

Ticket: `.scratch/vault-sync-impl/issues/05-sync-triggers-and-interruption-safety.md`
Branch: `feat/sync-triggers`
Status: decisions and test seams approved 2026-10-19, confirmed again 2026-10-20

## Decisions

- **Schedule settings (post-edit pause and polling interval):** per-device user settings in whole seconds, kept in this vault's localStorage (`App.saveLocalStorage`) with `formatVersion: 1`, never in `data.json` or the vault, and kept on disconnect:
  - **Post-edit pause** (also the typing pause for the open note): 1 to 60 s, default 2 s (2000 ms).
  - **Polling interval:** 10 to 3600 s, default 60 s (60,000 ms).
  - A missing, unreadable or out-of-range stored value reads as the defaults; an invalid typed value leaves the stored one in place and explains the valid range on the settings row.
- **Triggers and collapsing (`SyncEngine`):**
  - `start()` runs once the vault is open (`workspace.onLayoutReady`), subscribes to `vault.onChange` for the post-edit pause, schedules periodic polling, and starts the vault-open sync; it returns a cleanup function that unsubscribes on unload.
  - The shell also triggers `engine.sync()` on `document` `visibilitychange` when `visibilityState === "visible"` (`hidden` is not relied on) and on `window` `online`, and adds the "Full reconcile" command (`engine.reconcile()`).
  - A local change hint from `vault.onChange` (outside the engine's own vault writes during a sync) resets the post-edit pause timer; when a sync skips an open note because it is within the typing pause, it schedules a sync for when that pause ends.
  - At most one sync runs at a time per device. Any triggers that fire while a sync is running collapse into one follow-up sync immediately after it finishes; if any of them was `reconcile()`, the follow-up lists the Remote in full.
- **Offline and backoff retries:**
  - `SyncStatus` gains `{ state: "offline" }` (EN `"Offline"`, RU `"Офлайн"`), with no notice.
  - A sync that fails with `transient` shows `offline` and schedules a retry with exponential backoff starting at 5 s (`5000 * 2 ** attempt`, capped at 5 min). A sync that fails with `throttled` retries after `retryAfterMs`.
  - Any trigger cancels a pending retry timer and syncs at once; a completed sync resets the backoff counter. Other provider failures show `syncFailed` without backoff.
- **Local change detection (`mtime` and `size` first):**
  - A file's `SnapshotEntry` records `size` and `mtime` from the vault (`vault.stat(path)`) alongside `revision` and `hash`.
  - During the vault walk, a file whose snapshot entry has matching `size` and `mtime` keeps its recorded `hash` without calling `vault.read` or `contentHash`. Only new files or files whose `mtime` or `size` changed are read and hashed; if the content hash and Remote revision are unchanged, the snapshot entry's `size` and `mtime` are updated.
  - `FakeVault` advances a rewritten file's `mtime` by at least 1 ms when the `ManualClock` has not moved, so rewrites in tests always change `mtime`.
- **Change feed and full reconcile:**
  - **Dropbox and FakeDropbox:** `listFolder` returns `{ entries, cursor }`. `createDropboxProvider` reports `capabilities.changeFeed` over `files/list_folder/continue` (paged through `has_more`), returning the latest state (`file`, `folder` or `deleted`) of each path under the Remote root and the new cursor; a `reset` (409) maps to `cursorLost`. `FakeDropboxAccount` logs changes and deletions for `list_folder/continue` and answers `reset` for unknown cursors.
  - **Device store and engine:** `DeviceStore` keeps the Remote feed state (`cursor` and `entries` at that cursor; in IndexedDB on the device, in memory in tests, cleared on `clear()`). On a sync with `changeFeed`, a non-empty snapshot, a stored feed state, and no `reconcile` request, the engine calls `changeFeed.changes(cursor)` and applies the batch to the stored Remote entries; on First sync, `reconcile()`, or `cursorLost`, it calls `provider.list()`. The new feed state is saved only after the sync finishes without throwing.
- **Order of work and interruption safety:**
  - Local file uploads run first: text files (`contentKindOf(path, settings) === "text"`) before non-text attachments, smaller `size` before larger `size`, then path order; followed by local folders, then Remote downloads.
  - No persisted queue: the snapshot updates per entry after both sides hold the same content, and crashing before or after any provider call leaves work that the next sync finishes with no loss.
- **Review:** one code review at the end (step 8).

## Test seams

1. Sync engine through its ports: vault-open sync on `start()`, post-edit pause and typing-pause follow-up, polling, triggers during a sync collapsing into one follow-up, `mtime`-and-`size` shortcut skipping `vault.read` on unchanged files while syncing edits made while closed, `changeFeed.changes(cursor)` with fallback to `list()` on `cursorLost` and `reconcile()`, upload order (small text before large attachments, before downloads), `offline` status and exponential backoff retries without notices, and crashing before/after every step of a sync and finishing on the next sync. Misses DOM listeners and IndexedDB.
2. Provider contract suite and Dropbox provider tests: `list()` cursor, `changeFeed.changes(cursor)` across batches and pages, and `cursorLost` on a reset/unknown cursor, against FakeProvider and Dropbox over FakeDropbox. Misses the real Dropbox.
3. Schedule settings parsing and storage: post-edit pause (1–60 s, default 2 s) and polling interval (10–3600 s, default 60 s). Misses the settings tab DOM.
4. String table and status labels: `Offline` status label and EN/RU key parity.

## Steps

- [x] 1. Schedule settings (post-edit pause 1–60 s, default 2 s; polling interval 10–3600 s, default 60 s) and Offline status with EN/RU strings (seams 3, 4).
- [x] 2. Dropbox change feed: `list` returns a cursor, `changes(cursor)` over `list_folder/continue` with paging and `reset` → `cursorLost`; `FakeDropbox` change log; Provider contract suite (seam 2).
- [x] 3. Ports and stores: `mtime` and `size` on `SnapshotEntry`, Remote feed state (`cursor` and `entries`) in `DeviceStore` (in memory and IndexedDB), schedule settings port, `FakeVault` monotonic `mtime` on rewrite.
- [x] 4. Engine `sync-run`: `mtime`-and-`size` shortcut (hashing only changed files), change feed with fallback to full listing on `cursorLost` and on `reconcile`, upload ordering (small text before large attachments, before downloads), interruption safety across all steps (seam 1).
- [x] 5. Engine lifecycle and triggers: vault-open sync on `start`, post-edit pause and typing-pause follow-up, periodic polling, one sync at a time with collapsed follow-up, `reconcile()`, `Offline` status and exponential backoff retries (seam 1).
- [x] 6. Shell: localStorage schedule settings store, settings tab rows, Full reconcile command, `onLayoutReady` start, `visibilitychange` → `visible` and `online` listeners in `main.ts`.
- [x] 7. Full test run, typecheck, lint, build with a stand-in key.
- [x] 8. Code review, commit, ticket closed.

## Review fixes

Chosen by the user on 2026-10-20 from the step 8 review: every finding. Each fix is test-first where it changes behaviour.

- [x] P1. A file's size and mtime are recorded as stat before it was read, so an edit saved during the sync is a change next time.
- [x] P5. A download refused by `replaceIfStill` because the vault file no longer matches the snapshot merges instead of skipping.
- [x] P2. The change feed is applied in order: deletions kept, a folder's children removed when a file or deletion replaces it; the result equals a full listing.
- [x] P4. Crash points also at vault writes and at snapshot and feed saves; the crash loop asserts it reached a completed run.
- [x] P3, S4. `start()` arms and returns its cleanup at once; the vault listener is registered with the plugin; a timer frees its cleanup when it fires or is cancelled.
- [x] P6. Visibility and online triggers, and the sync after connecting, wait for the layout.
- [x] P7. No sync right after connecting; the dead `isBeingTyped` removed.
- [x] P8. A listing reset falls back once to a fresh `list()`; the feed state is saved only when its cursor changed.
- [x] S1, S2, S3, S5. Glossary terms; doc comments on fields; the workspace's own document and window; the reconcile test through `engine.reconcile()`.
- [x] S6, S7, S12. One settings-row helper; one timer helper; one seconds-setting type.
- [x] S8, S9, S10, S11. Shared path folding and sorting; one pause default; no test-only optional ports; size and mtime as one stat field.
- [x] S13, S16. Engine triggers as one explicit state; the vault wrapper reduced to what it changes.
- [x] S14, S15. Shared schedule test helper with `stop()` in `finally`; plain filenames; the upload-order test asserts the Remote's order, not spies.
