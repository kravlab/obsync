# Plan: 09 Deletions and the Deletion guard

Ticket: `.scratch/vault-sync-impl/issues/09-deletions-and-the-deletion-guard.md`
Branch: `feat/deletions` (new, from `origin/main` at `f77837e`, which has ticket 08)
Status: plan and decisions approved 2026-10-21

## Decisions

- **Detecting deletions.** From the Sync snapshot S only, no tombstones (spec, "Deletions and renames"). For a path in S:
  - missing in the vault, present on the Remote → deleted here;
  - missing on the Remote, present in the vault → deleted on the Remote;
  - missing on both → S entry dropped, nothing else.
  A path counts as missing only when it is absent from the raw listing, not when `syncListing` left it out (case clash, entry below a file on the other side, Metadata or configuration folder). Otherwise a case clash appearing on one side would look like a deletion and trash files.
- **Deleted here, unchanged on the Remote** (R's revision is S's): `provider.delete(path, { revision: S.revision })`, then the S entry and its Base are removed.
  - `preconditionFailed` (another device wrote it since the listing): the file is read again and restored into the vault, with the notice below.
  - `notFound` (another device deleted it too): S entry removed.
- **Deleted on the Remote, unchanged here** (vault stat equals S's stat, else hash equals S's hash): `vault.trash(path)` (`FileManager.trashFile`, the user's trash setting), then the S entry and Base are removed. A note within the post-edit pause is left for a later sync. The content is checked again just before trashing; there is no atomic "trash if unchanged", so an edit in the few milliseconds between that check and the trash goes to the trash with the file (recoverable there).
- **Edit beats delete, both directions:**
  - deleted here, edited on the Remote (R's revision differs and its content hash differs from S's): R is downloaded back into the vault and recorded;
  - deleted on the Remote, edited here (vault hash differs from S's): the file is uploaded with "absent" and recorded.
  - Notice `restoredAfterDelete` with `path` and `deletedOn: "thisDevice" | "otherDevice"`. EN/RU texts: "“{file}” came back: it was deleted here but edited on another device." / "“{file}” was kept: it was deleted on another device but edited here." The other device is not named: without Device journals the writer of a Remote revision is unknown (the same reason Conflict blocks say "Remote").
- **Folders.** A folder's S entry is handled after every file inside it.
  - Deleted here: after its files, the Remote is listed again once per sync (the change feed when there is one, else a full listing), and only folders with nothing below them in that listing are deleted, deepest first. A folder another device added a file to stays, and that file downloads, recreating the folder locally. A window remains between that listing and `delete`, since Dropbox has no conditional folder delete; a file added in that window goes to Dropbox's deleted files. This is the spec's rule ("only when a listing shows it empty") and I flag the window rather than hide it.
  - Deleted on the Remote: the vault folder is trashed only if `vault.list` shows it empty after its known files went; a new local file inside keeps it, and its upload recreates the Remote folder (already the case today).
- **Order of work.** List both sides → classify deletions and restores → Deletion guard → uploads → deletions → downloads (spec, "Order of work": uploads first, then downloads).
- **Deletion guard** (engine, pure function `deletionGuard` plus the prompt):
  - counts files only, per direction: deletions to apply on the Remote and deletions to apply in the vault;
  - trips when either direction deletes more than N files, or more than P% of the files in S;
  - always trips for a missing vault (S has files, the vault listing has none of the synced files) and for an empty Remote mirror (S has files, the Remote listing has none outside the Metadata folder);
  - the Remote root folder itself gone already stops sync before listing (`settings.json` is not found, status "Sync failed"); that stays as it is until Reconnect (ticket 14), and the spec's open risk "what happens when the App Folder is renamed or deleted" stays open;
  - defaults: **N = 100 files, P = 50 %**. P follows rclone bisync's `--max-delete` default (50 %, "on either the Path1 or Path2 filesystem", abort without changes). N is my choice: it bounds a large vault, where 50 % could be thousands of files;
  - N and P are per-device settings in Obsidian's localStorage, like the post-edit pause; they are not in the spec's list of shared Remote settings. Settings tab: two number fields, EN/RU strings, validation (N: whole number 1–100000; P: whole number 1–100).
- **The prompt.** New `UiPort.askDeletions(request): Promise<"apply" | "restore" | null>`, awaited by the engine. `request` carries the paths per direction and the reason (`threshold`, `missingVault`, `emptyRemote`). The modal shows the counts, a "Review list" toggle with every path per direction, and Apply / Restore buttons.
  - Apply: the deletions run as above.
  - Restore: files deleted here are downloaded back; files deleted on the Remote are uploaded back with "absent". Both are recorded.
  - Closed without a choice (`null`): nothing is deleted or restored, this sync stops before any write, status `deletionsOnHold` ("Deletions waiting for you"). Automatic triggers do not prompt again while on hold; "Sync now" asks again. The hold lives in memory only, so a restart asks once more.
- **Dropbox `delete_v2` with a stale `parent_rev`.** Not documented: the API spec lists `DeleteError` = `path_lookup | path_write | too_many_write_operations | too_many_files`, and no source found states which one a mismatch returns (checked: `dropbox-api-spec` `files.stone`, the Python SDK docs, Dropbox forum, several open-source clients that only assume `path_write/conflict`). It cannot be checked from this container: `api.dropboxapi.com` is blocked by its network policy (proxy 403). It needs one live check with your Dropbox app, see step 1. If the answer is `path_lookup/not_found`, a concurrent edit would look like "already deleted" and the edit would be lost: then the provider follows such a `not_found` with `get_metadata` and maps "file exists" to `preconditionFailed`.
- **DeviceStore.** New `removeSnapshotEntry(path)`, which removes the entry and its Base together, durable on resolve; IndexedDB and in-memory implementations.
- **Renames** are ticket 10. Until then a rename is a delete plus a new file; a big folder rename may trip the guard (rclone documents the same effect).
- **Review:** one code review at the end.

## Test seams

1. Deletion guard, pure: thresholds N and P in each direction, exactly at and just above each, missing vault, empty Remote mirror, folders not counted. Misses the engine.
2. The sync engine through its ports (spec seam 1), multi-device on one FakeProvider: delete propagated each way into the trash, delete versus edit each way with the notice, a concurrent write after the listing refusing the delete (`preconditionFailed`) → restored, deleted on both sides, folder delete racing an add (file in the listing, and file added just before the empty-check listing), Remote folder deleted with a new local file inside, typing pause leaves the file, a case clash not taken as a deletion, guard prompt with Apply / Restore / closed and on hold, "Sync now" asking again.
3. Provider contract suite (seam 2): delete with a stale revision → `preconditionFailed`, with the FakeDropbox answer changed to what step 1 finds.
4. Shell text: `restoredAfterDelete` notice and `deletionsOnHold` status label in EN and RU; parsing of the two settings.

The modal itself and the trash setting are checked by hand in Obsidian.

## Steps

- [x] 1. Confirm the `delete_v2` stale `parent_rev` answer on the real service (you run it, see "Open before step 1"); record it in the FakeDropbox, the provider mapping and its doc comment. Checked 2026-10-21: 409 `path_write/conflict/file/`, already mapped to `preconditionFailed`; a test pins the recorded body.
- [x] 2. Deletion guard module and its settings parsing (seams 1, 4). The three whole-number settings now share `whole-number.ts`.
- [x] 3. `DeviceStore.removeSnapshotEntry`, `syncListing` reporting the paths it left out (`goneLocally`, `goneRemotely`).
- [x] 4. Engine: file deletions both ways, edit beats delete, notice (seam 2). The notice's EN/RU text came with it, since the shell's notice switch must cover every kind to compile. The ticket 03 test "leaves deletions on either side unapplied" is removed: this ticket replaces that behaviour.
- [x] 5. Engine: folder deletions with the empty check (seam 2), also through the change feed.
- [x] 6. Engine: Deletion guard prompt, Apply / Restore / on hold (seam 2). `SyncEngine.sync` takes a source; only `user` lifts a hold.
- [x] 7. Shell: modal, settings fields, notice and status texts EN/RU, wiring in `main.ts` (seam 4). Visibility and online events sync as `automatic`. Restore is the highlighted button: `setWarning` is deprecated and `setDestructive` needs Obsidian 1.13, above `minAppVersion`.
- [x] 8. Full test run, typecheck, lint, build with a stand-in key: 448 passed, 4 skipped (as before), all clean.
- [ ] 9. Code review, then commit and ticket closed on your go-ahead. Review done 2026-10-21; the chosen fixes are below.

## Open before step 1

- The live Dropbox check needs your app key and a login, which must not enter the repo or this container. Proposed: on your machine, a short-lived access token from the App Console of your app, then upload a file twice and call `delete_v2` with the first `rev`; I give the exact `curl` commands, you send back the response body.

## Review fixes

Chosen by the user on 2026-10-21 from the step 9 review (R10 is kept as it is: tests for the IndexedDB store need a new dependency). Each fix is test-first where it changes behaviour.

- [x] R1. A file deleted here whose Remote revision changed is read before the guard; the same content counts as a deletion (`toRemote`, with the new revision), so the guard counts it and Restore brings it back.
- [x] R2. `syncListing` also matches Remote entries to the snapshot's paths, so on a case-insensitive provider a file deleted here whose Remote name differs in case is deleted, not downloaded again.
- [x] R3. `missingVault` and `emptyRemote` count the synced files still on each side, not all files.
- [x] R4. The shell closes an open Deletion guard prompt when the plugin unloads, which answers null.
- [x] R5. A sync the user asks for while the prompt is open is not held when the prompt is closed.
- [x] R6. The review list labels each side's paths.
- [x] R7, R9 (prefix). Folder emptiness checks use one set of parent folders, built once, with `isWithin`-equivalent keys.
- [x] R8. Trashing checks the stat first and hashes only when it differs, through the same helper as `unchangedHere`.
- [x] R9. `SyncedFile` lives in `sync-snapshot.ts`; one helper forgets a file gone from the Remote.
