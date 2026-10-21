# Plan: 11 First sync

Ticket: `.scratch/vault-sync-impl/issues/11-first-sync.md`
Branch: `feat/first-sync` (new, from `main` at `61813c9`, which has ticket 10)
Status: plan and decisions approved 2026-10-21: mark timeout 6 hours; the settings pick waits for ticket 15; one summary notice per First sync

## Facts checked

- **What a sync without a snapshot does today:** a full listing and a union. A file on one side only is copied; the same content on both sides is recorded; differing text merges 2-way into Conflict blocks; differing JSON and binary files get Conflict copies; nothing is deleted. There is no preview, no bulk option, no server hash, no mark and no re-registration.
- **"Has a snapshot" cannot be told today.** `loadSnapshot` returns an empty map both for "never synced" and for "synced an empty vault", so a device that synced an empty vault would look new on every sync.
- **Dropbox `content_hash`** ([Content hash](https://www.dropbox.com/developers/reference/content-hash)):
  - split the file into 4 MiB blocks (4,194,304 bytes), the last one possibly smaller;
  - take the SHA-256 of each block, concatenate the binary digests, and take the SHA-256 of that, as hex;
  - an empty file has no blocks, so its hash is the SHA-256 of nothing.

  `FileMetadata.content_hash` is optional in the API spec. `list_folder` is documented to leave out `media_info`, not `content_hash`. When it is missing, the engine falls back to downloading the file.
- **Shared settings:** `connect` already writes `settings.json` only if absent. Every device writes the defaults, because no UI chooses other values before ticket 15, so two devices setting up one Remote cannot write differing values yet.

## Decisions

### When a sync is a First sync

- **What counts as having a Sync snapshot.** A completed First sync is recorded in the Device store, in the same IndexedDB database as the snapshot, so it is lost together with it.
  - `DeviceStore` gets `hasSnapshot(): Promise<boolean>` and `markSnapshotComplete(): Promise<void>`. The in-memory store gets them too.
  - A database of another format version reads as no snapshot, which gives a First sync, as the spec's state-format note asks.
- **Lost snapshot versus a new device.** The Connection gets `firstSyncDone: boolean` (missing in older records = false), set once a First sync completes, and on any later completed sync if it is still false.
  - Connection says done and no snapshot → the snapshot was lost → re-register under a new Device ID.
  - Connection not done → a new device, or a First sync cut off earlier → keep the Device ID it has.
  - The old record ages out under the inactive-device rule. That rule does not exist yet (it belongs to the device list): until then the old record just stays.
- **A First sync cut off half way** starts over as a First sync, preview included. Entries it already recorded show as identical.

### Preview

- **New `UiPort.askFirstSync(preview)`**, resolving to `{ differing: "merge" | "keepRemote" } | null`, where null means the modal was closed. The engine computes the preview from a full listing before writing anything.
- **What the preview holds.** Counts and the full lists of files, not folders:
  - to download;
  - to upload;
  - identical;
  - differing, each with what happens to it: merged into Conflict blocks, or a Conflict copy.

  Files the listing leaves out (configuration folder, case clashes) are not shown.
- **How identical is decided.** By the plugin's content hash. Where the Remote entry carries a server hash in an algorithm the engine can compute, the vault file is hashed that way instead of downloading the Remote file. Otherwise the preview downloads the Remote file to compare it; that changes nothing on either side.
- **The modal.**
  - The four counts, a "Show list" toggle, and the option "Use the Remote version for every differing file and keep mine as Conflict copies" (off by default).
  - **Start** and **Cancel** buttons.
  - Closing or cancelling holds sync, as a closed Deletion guard prompt does: a new status `firstSyncWaiting` ("First sync waiting for you"). Automatic triggers do not ask again; "Sync now" does.
- **When nothing needs a choice** (an empty vault, an empty Remote, or no file on both sides), the preview is still shown. The spec says nothing changes until the user starts the sync, and a new device's first sync is exactly that moment.

### Running it

- **Order once the user starts:**
  1. Re-register, if the snapshot was lost.
  2. Write the "First sync in progress" mark into this device's record.
  3. Run the union (the existing sync with no snapshot), with the chosen handling of differing files.
  4. Mark the snapshot complete, clear the mark, and set `firstSyncDone`.
- **"Keep Remote" option.** Every file on both sides with different content, text included, keeps the Remote version under its name, and the vault's version becomes a Conflict copy, as for binary files today.
- **Identical files by server hash** (outside the preview too, for any file created on both sides without a snapshot):
  - the engine module `server-hash.ts` knows the algorithm by a neutral name, `sha256-4mib-blocks`;
  - the Dropbox provider reports `content_hash` under that name; FakeRemote gets a `serverHashes` option;
  - a match records the file without a download, with the vault's bytes as its Base.
- **The "First sync in progress" mark.**
  - The device record gets `firstSyncStartedAt` (ms since the epoch, device clock).
  - A device connecting to a Remote whose records show a mark younger than the timeout gets a new outcome, `firstSyncInProgress` (with that device's name), from `useFolder`. The connect modal says to wait and offers "Connect anyway", which calls `useFolder` again with `evenDuringFirstSync`.
  - Finding the records needs a full listing of the Remote, once, at connect.
  - A stale mark, older than **6 hours**, is ignored.
  - Clocks differ between devices, so the timeout is generous.
- **The Deletion guard** has nothing to count in a First sync (no snapshot, no deletions). It is left as it is.

### Notices

Approved: during a First sync, per-file Conflict-copy notices are replaced by one summary notice at the end, `firstSyncDone`, with counts: downloaded, uploaded, merged with Conflict blocks, Conflict copies. Many differing files would otherwise give a burst of notices.

### Shared settings at First sync

Approved:
- Keep "only if absent" for `settings.json`, as now.
- Leave the "pick the value" prompt to ticket 15, which is the first ticket that lets values differ.
- An engine test proves that two devices setting up one empty Remote at once end with one settings file and a union of their files.

## Test seams

1. **Engine through its ports** (seam 1), two or three devices on one FakeRemote:
   - empty vault and full Remote; full vault and empty Remote; both full, with identical, differing text and differing binary files;
   - the preview's counts and lists, and that nothing changes before Start;
   - the "Keep Remote" option;
   - Cancel and the hold, with "Sync now" asking again;
   - the server hash: an identical file is not downloaded;
   - a lost snapshot: a new Device ID and a new record;
   - a First sync cut off half way, then repeated;
   - two devices setting up one empty Remote at once;
   - the mark seen at connect, "Connect anyway", and a stale mark.
2. **The server-hash function** against the Dropbox example values.
3. **Provider contract and Dropbox** (seam 2): `serverHash` on listed files, mapped from `content_hash`.
4. **Shell:** preview, status and notice text in EN/RU.

Checked by hand in Obsidian: the preview modal and the connect warning.

## Steps

- [x] 1. `DeviceStore.hasSnapshot` / `markSnapshotComplete` (both stores); `Connection.firstSyncDone`.
- [x] 2. `server-hash.ts` and its tests; FakeRemote `serverHashes`; the engine records identical files by server hash.
- [x] 3. Engine: the First sync preview, `askFirstSync`, the hold and status.
- [x] 4. Engine: the "Keep Remote" option, re-registration, completion, notices.
- [x] 5. Engine and connection: the "First sync in progress" mark and the connect outcome.
- [x] 6. Dropbox: `content_hash` as a server hash; FakeDropbox (with a synchronous SHA-256 in `test/support`, since the project has no Node types); contract test.
- [x] 7. Shell: the preview modal, the connect warning, status and notice texts in EN/RU, wiring in `main.ts`. UI text keeps sentence case (the lint rule), so it writes "conflict copy" in lower case.
- [x] 8. Full test run, typecheck, lint (`src`, `test`), build with a stand-in key: 563 passed, 4 skipped; all clean. Setup helpers in older tests drop the notices of their own First syncs (`forgetNotices`).
- [x] 9. Code review done 2026-10-21; the chosen fixes are below. After them: 564 passed, 4 skipped; typecheck, lint (`src`, `test`) and build clean.

## Review fixes

Chosen by the user on 2026-10-21 from the step 9 review. The review's c2 (`hasSnapshot` ignoring the format version) was checked and does not hold: `databaseName()` already compares the format version, so a new format means a new database without the mark, hence a First sync.

- [x] R1. A First sync ignores stored snapshot entries: no renames or deletions, only the union. Entries it records replace the old ones; leftovers are settled by the next sync. Test: a First sync cut off after recording a file that another device then deletes.
- [x] R2. A snapshot database upgraded from schema 1–3 gets the "complete" mark, so a device that synced before this ticket gets no First sync. Checked by hand (the IndexedDB store has no tests).
- [x] R3. No Dropbox in engine comments of this change; the contract test of server hashes compares with a literal value.
- [x] R4. One server-hash check; a `SyncHold` type; named counts in the preview text; a tally that counts nothing outside a First sync instead of `undefined` checks; one helper for the Connection's First sync state.
- [x] R5. Small items: `ConnectionPorts.clock` doc, `deviceInFirstSync` name, a list class of its own for the preview, import order, a simpler `connectWith`.
- [x] R6. First sync tests assert what users see rather than store fields; the connect test gets its mark from a real First sync.
- [x] R7. Ticket 15 gets two comments: differing settings from two devices setting up one empty Remote stop sync until the user picks; the old record ageing out after a re-registration (the device list is in ticket 15, not 14; the user chose 15).
