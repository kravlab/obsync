# Plan: 10 Renames and moves

Ticket: `.scratch/vault-sync-impl/issues/10-renames-and-moves.md`
Branch: `feat/renames` (new, from `main` at `7bab976`, which has ticket 09)
Status: plan and decisions approved 2026-10-21; Dropbox move and stable id in this ticket; case-only renames handled locally only

## Facts checked

- **Dropbox ids.** `FileMetadata.id` and `FolderMetadata.id` are "a unique identifier" (`files.stone`); the provider survey (`research/provider-capabilities.md`, [D4]) quotes Dropbox: a "unique file reference that persists if files are moved or renamed". The provider does not report it yet.
- **Dropbox move.** `files/move_v2` (`RelocationArg`: `from_path`, `to_path`, `autorename`) moves a file or a folder with everything in it and returns the moved entry's metadata. Errors (`RelocationError`): `from_lookup` (LookupError), `from_write`, `to` (WriteError, with `conflict/file|folder` for an occupied target), `too_many_files` (over 10,000 entries), `insufficient_quota`, others. It has no revision precondition on the source. "We do not currently support case-only renaming." Not documented: whether a moved file keeps its `rev`. The design below does not depend on it.
- **Case-only renames today** (checked with a throwaway test on a case-insensitive FakeRemote): `note.md` renamed to `Note.md` on one device stays `note.md` on the Remote and the other device, and that device's Sync snapshot keeps both `note.md` and `Note.md` for the one file.
- **Obsidian's `rename` event** gives the new `TAbstractFile` and the old path. Whether a folder rename also fires one event per file inside is not in `obsidian.d.ts`; the design works either way (a folder hint is applied to every path below it).

## Decisions

### Model: a rename moves the snapshot entry

A rename is carried by moving the Sync snapshot entry, and its Base, from the old path to the new one, after doing the same move on the side that does not have it yet. Content is then compared as for any synced file, so rename plus edit needs no extra rule: an edit on one side is copied, edits on both sides merge against the moved Base, per the existing policies.

- The moved entry keeps the old revision, unless the new Remote path is known to hold the synced content under another revision (a hash match read it). A Remote file whose revision differs from it is then read and compared by hash in the same sync: a false alarm costs one download, and an edit made on the Remote during the move is never taken for the synced content.
- New `DeviceStore.moveSnapshotEntry(from, to, entry)`: removes `from` and writes `to` with `from`'s Base, in one durable step. IndexedDB and in-memory implementations.
- `SnapshotEntry` gets an optional `stableId` (files and folders), recorded from the Remote entry when the provider gives one.

### Detection (new pure module `renames.ts`, run after the listing, before deletions)

For a path P in the snapshot S:

- **Here:** P is gone from the vault listing and a vault entry A of the same kind, not in S, is
  - the target of the rename hints (the `rename` events since the last completed sync, applied in order; a folder hint moves every path below it), or
  - for a file, the only new vault file whose content hash is S(P)'s, and P the only vanished file with that hash. Only new files whose size equals a vanished file's recorded size are hashed.
- **On the Remote:** P is gone from the Remote listing and a Remote entry B, not in S, is
  - the entry with S(P)'s stable id, or
  - for a file, the only new Remote file whose content hash is S(P)'s, unique both ways as above. Only new Remote files whose size matches are read; the vault having the path does not exclude one, so a rename onto a path occupied here is still found.
- **Folders:** a folder F renamed to G when its stable id or a hint says so, or when every file the snapshot has below F was renamed, on that side, to the same place below G.
- Anything ambiguous stays a delete plus a create, as today.
- **Hints** live in the engine's memory only, collected from vault events that are not the engine's own writes, and dropped after a sync that completes. A restart loses them; the hash match then covers unedited files.

### Applying (sync-run, before uploads; renames are writes, so after the Deletion guard)

The Deletion guard counts no renamed file; a closed prompt still stops the sync before any write, renames included.

| Here | On the Remote | What happens |
|---|---|---|
| P → A | P unchanged path | Remote: move P → A; entry P → A. |
| P unchanged path | P → B | Vault: `vault.rename(P, B)`; entry P → B. |
| P → A | P → A | Entry P → A only (also an interrupted move). |
| P → A | P → B | Remote name wins: `vault.rename(A, B)`; entry P → B; notice `renamedOnBoth` naming A and B. |
| P → A | P deleted | P forgotten; A uploads as a new file; notice `renameBeatsDelete`, deleted on the other device. |
| P deleted | P → B | P forgotten; B downloads as a new file; notice `renameBeatsDelete`, deleted here. |

- **Remote move of a file,** P → A:
  - with the file move Capability: `moveFile(P, A)`;
  - without: write-new then delete-old. The bytes written are the vault file's when the Remote still has S's revision and the vault file S's content, else the Remote file's, read first. Then P is deleted on condition of the revision those bytes came from. Cut off between the two, the next sync sees A on the Remote with the moved content and only deletes P. A delete refused because another device wrote P meanwhile leaves P on the Remote, where the next sync finds it as a new file: nothing is lost.
- **Rename onto an occupied path:**
  - P → A here, A taken on the Remote by another file (not in S, and not this device's own interrupted copy, told apart by content hash): the vault's A becomes a Conflict copy name C (`conflictCopyPath`, free on both sides), the rename is carried as P → C, and the Remote's A downloads. Notice `conflictCopyCreated` (path A, copy C).
  - P → B on the Remote, B taken in the vault by a new file: the vault's B is renamed to a Conflict copy C first (it uploads as a new file), then P → B. Same notice.
  - Text files too: the spec asks for a Conflict copy here, not a merge.
- **Folders:**
  - F → G here: one `moveFolder(F, G)` when the provider has the folder move Capability, G is free on the Remote, and no entry below F was renamed or deleted on the Remote. Otherwise each entry inside is moved as above, and F is deleted on the Remote by the deletion rules once a listing shows it empty.
  - F → G on the Remote: one `vault.rename(F, G)` when G is free in the vault and no entry below F was renamed or deleted here. Otherwise entry by entry, with F trashed by the deletion rules once empty.
  - Every snapshot entry below F moves to the same place below G.
- **Remote renames are applied with `vault.rename`, never `FileManager.renameFile`** (port already says so; the Obsidian adapter already uses `vault.rename`).

### Dropbox provider

- Listing and feed entries report `stableId` from `id`; written and moved files report it too.
- New `fileMove` and `folderMove` Capabilities over `files/move_v2` with `autorename: false`. `to/conflict/*` → `preconditionFailed`; `from_lookup/not_found` → `notFound`; `too_many_write_operations` → `throttled`; `too_many_files` and the rest → `permanent`, which the engine answers by moving entry by entry (a folder over 10,000 entries).
- FakeDropbox learns `move_v2`; the Provider contract suite gets a stable-id section and file/folder move sections, skipped where the Capability is absent.

### Case-only renames on a case-insensitive provider

See the question asked with this plan. Proposed: this device's snapshot follows the vault's new case (entry moved, so no stale duplicate entry), and the Remote and other devices keep their case. `move_v2` cannot do it, and `syncListing` already lets each side keep its case.

### Notices (EN / RU)

- `renamedOnBoth` (`path` B, `localPath` A): "“{local}” was renamed differently on another device and is now “{file}”." / "«{local}» переименован на другом устройстве иначе и теперь называется «{file}»."
- `renameBeatsDelete` (`path`, `deletedOn`):
  - `otherDevice`: "“{file}” was kept: it was deleted on another device but renamed here." / "«{file}» сохранён: его удалили на другом устройстве, но переименовали здесь."
  - `thisDevice`: "“{file}” came back: it was deleted here but renamed on another device." / "«{file}» вернулся: его удалили здесь, но переименовали на другом устройстве."

## Test seams

1. `renames.ts`, pure: hint chains and folder hints, unique and ambiguous hash matches here and on the Remote, stable-id matches, folder renames derived from files.
2. Sync engine through its ports (seam 1), two devices on one FakeRemote, with and without stable ids (new FakeRemote option `stableIds`), file move and folder move:
   - rename carried each way, no re-upload with the move Capability, `vault.rename` used and nothing trashed;
   - offline rename by hash, ambiguous match as delete plus create, rename with an edit (offline and by hint);
   - rename plus edit elsewhere, plus edit on both (merge against the moved Base);
   - rename plus delete, both ways, with the notice;
   - two different renames, with the notice; the same rename on both;
   - rename onto an occupied path, both ways;
   - folder rename with one folder move, and entry by entry (Capability absent, or something inside renamed on the other side), with a file added inside meanwhile;
   - interrupted move (crash between write-new and delete-old, and between the move and the snapshot), completed next sync;
   - Deletion guard not tripped by a large folder rename;
   - case-only rename (per the answer below).
3. Provider contract (seam 2): stable id survives a move, a new file at the same path gets a new one; file and folder move, occupied target refused; Dropbox error mapping.
4. Shell: notice texts EN/RU.

The Obsidian side (a folder rename's events, mtime kept by `vault.rename`) is checked by hand.

## Steps

- [x] 1. `SnapshotEntry.stableId` (and `size`, for the hash match), `DeviceStore.moveSnapshotEntry` (both stores), FakeRemote `stableIds`.
- [x] 2. `renames.ts` detection (seam 1). A folder rename is reported only when one move carries it (folder move Capability on the Remote, `vault.rename` in the vault) and nothing inside contradicts it; any other folder rename is left to the deletion rules and the new folder is created as usual, its files still carried as renames. This replaced a planned per-entry folder carry with its own clean-up.
- [x] 3. Engine: file renames each way, rename plus edit, write-new then delete-old (seam 2).
- [x] 4. Engine: combinations: both renamed, rename plus delete, occupied path; notices with EN/RU text, worded like the existing `restoredAfterDelete` notices (no quotes around paths).
- [x] 5. Engine: folder renames, interrupted moves (every step, on the renaming and on the receiving device, with and without move Capabilities), guard.
- [x] 6. Engine: rename hints from vault events.
- [x] 7. Dropbox: `stableId`, `move_v2` Capabilities, FakeDropbox, contract suite (seam 3). FakeDropbox keeps a moved file's `rev`; Dropbox does not document it, and the engine does not rely on it.
- [x] 8. Case-only renames: the snapshot entry follows the vault's case; the Remote keeps its own.
- [x] 9. Full test run, typecheck, lint, build with a stand-in key: 528 passed, 4 skipped (as before); typecheck and build clean; lint clean for `src` and `test`. `pnpm lint` also reports an untracked prototype file, `.scratch/vault-sync/prototypes/mobile-runtime-checks/vault-sync-probe/main.js`, not part of this change.
- [x] 10. Code review done 2026-10-21; the chosen fixes are below. After them: 534 passed, 4 skipped; typecheck, lint (`src`, `test`) and build clean. Committed in `347381b`.

## Review fixes

Chosen by the user on 2026-10-21 from the step 10 review. Each fix that changes behaviour is test-first.

- [x] R1. A Remote file with a new revision but the synced content, edited here, is uploaded over that revision instead of merged: no spurious Conflict copy for a binary file (also outside renames).
- [x] R2. A new path taken on the Remote after the listing defers the rename to the next sync, which makes the Conflict copy; the upload pass no longer merges the two unrelated files.
- [x] R3. The engine drops only the `rename` events of its own renames (matched by path, a folder's inside it), not every rename while it writes.
- [x] R4. Rename hints taking two snapshot entries to one path are ambiguous: neither is a rename by hint.
- [x] R5. A file renamed on one side and gone on the other, whose new name that other side holds as a new file, is treated as a rename onto an occupied path: the vault's file becomes a Conflict copy and the Remote's keeps the name, with that notice only. This covers a cut-off between carrying a rename and moving the snapshot entry, on either side, which cannot be told apart from it; the user chose it over a durable rename intent.
- [x] R6. The crash-at-every-step tests include a file edited on the other device. They found a cut-off copy of a Remote edit not recognised as this device's own: a copy at the new path now also counts as one when it holds what the old path holds.
- [x] R7. Plan wording: new Remote files are read for the hash match even when the vault has the path, so a rename onto a path occupied here is found.
- [x] R8. No `as never` / `as T` casts in the new code.
- [x] R9. `movedAlong` and `followMoves` in `paths.ts`; one Conflict-copy step for vault files in the way; one helper for the crash loops.
- [x] R10. Clearer names: `sameOnBoth`, `differentOnBoth` with `vaultPath` and `remote`; folder moves and hints share `Move` in `paths.ts`.
- [x] R11. Test structure: one describe for the hint tests.
- [x] R12. Applying renames moves out of `sync-run.ts` into its own module, `carry-renames.ts`.
- [x] R13. "Stable id" in `GLOSSARY.md` (domain-modeling).
