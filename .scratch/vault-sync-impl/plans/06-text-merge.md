# Plan: 06 Text merge and Conflict blocks

Ticket: `.scratch/vault-sync-impl/issues/06-text-merge-and-conflict-blocks.md`
Branch: `feat/text-merge`
Status: decisions and test seams approved 2026-10-19

## Decisions

- **Merge library:** `node-diff3` 3.2.1, pinned exactly (MIT, no dependencies, ESM with types, no Node built-ins). Lines are passed as arrays, never strings. 3-way: `diff3Merge(ours, base, theirs)`, which takes an identical change on both sides as no conflict. 2-way: `diffComm(ours, theirs)`, every differing region a Conflict block; diff3 with an empty base would make the whole file one block.
- **Text merge function:** a pure function from the Base (or none), this device's bytes and the Remote's bytes, plus the two labels, to the merged bytes and whether a Conflict block was written; none when any version is not UTF-8. Versions are compared and merged as LF without BOM; the result takes the local file's style: its BOM and its line ending (CRLF when the local file's line breaks are mostly CRLF). Lines keep their line break, so a missing final newline is a difference like any other. Old markers are plain lines.
- **Conflict block:** `<<<<<<< <this device's name>`, this device's lines, `=======`, the Remote's lines, `>>>>>>> Remote`. The second label is always `Remote`: this release has no Device journals, so the other device is never known.
- **Text:** the extension, without case, is in the shared text-extension list, and every version decodes as UTF-8. Anything else changed on both sides is left alone until ticket 08.
- **Shared Remote settings** are read from `.obsync/settings.json` at the start of every sync. Missing, unreadable or of an unknown format version: the sync stops before touching anything and shows Sync failed.
- **Base:** the bytes of a text file at its last sync, in the Device store: a second IndexedDB object store, written in the same transaction as the snapshot entry, so the two never diverge; read per file when merging. A Base whose content hash is not the entry's is not used. The snapshot database is upgraded in place, keeping existing entries. Disconnect erases it with the snapshot.
- **When the merge runs:**
  - a file changed on both sides since the snapshot: 3-way against the Base; 2-way without one (e.g. synced before this ticket);
  - a text file created on both sides with different content and no snapshot entry: 2-way;
  - an upload refused with `preconditionFailed`: the Remote version is read again and merged in the same sync.
- **Applying a merge:** the same bytes go to both sides. The vault file is written only if the result differs from it and it still holds what was read; the Remote only if the result differs from what was read, on condition of the revision read. Then the path is recorded with the new revision, hash and Base. A refused upload is left for the next sync.
- **Provider contract:** `read` returns `{ data, revision }`, the revision of the bytes returned: Dropbox already learns it from `get_metadata`.
- **Typing pause:** 2 s. A vault file typed into in an editor within the last 2 s is not written by this sync (download or merge); it waits for a later sync. Ticket 05 makes the pause a setting and adds the trigger after it. The Local vault port reports when a path was last typed into.
- **Open editor:** the shell writes a file that is open in an editor through the Editor API, replacing only the range between the common prefix and suffix, so a cursor outside it stays; other files go through the Vault API. Checked by hand.
- **Review:** one code review at the end.

## Test seams

1. Sync engine with several devices on one FakeRemote: clean merge; Conflict blocks labelled with the device name and `Remote`; the 2-way merge for a synced file without a Base and for a file created on both sides; line-ending and BOM-only differences; non-UTF-8 and non-text files left alone; a `preconditionFailed` race merged in the same sync; the typing pause; old markers; missing `settings.json`. Misses Obsidian's editor and IndexedDB.
2. Provider contract suite: `read` returns the revision of the bytes it returned, the one the listing and `write` report. FakeProvider and Dropbox over the fake service. Misses the real Dropbox.
3. Text merge function: Base or none, both versions and labels to the merged bytes and whether they conflict, in the local file's style. Misses the engine wiring.

The IndexedDB Base store, the typing tracker and the editor write are checked by hand.

## Steps

- [x] 1. Provider contract: `read` returns `{ data, revision }` (seam 2); FakeProvider, Dropbox and every caller.
- [x] 2. `node-diff3`; the text merge function (seam 3).
- [x] 3. Ports: Base in the Device store (in memory), last typed time in the Local vault, settings read at sync start; test devices get a `settings.json`.
- [x] 4. Engine merges (seam 1).
- [x] 5. Shell: IndexedDB Base store with the upgrade, typing tracker, editor write.
- [x] 6. Full test run, typecheck, lint, build with a stand-in key.
- [x] 7. Code review, commit, ticket closed.

## Review fixes

Chosen by the user on 2026-10-19 from the step 7 review. Each fix is test-first where it changes behaviour. P5 (a skipped vault write may nest the same block again; nothing lost) and P7 (no sync after the typing pause until ticket 05) are accepted as they are.

- [x] P2, S4. One compare-and-write port call: `replace(path, expected, data)` writes only if the file still holds exactly `expected`. An open note compares the editor's unsaved text; other text files go through `Vault.process`; the rest compare the bytes just before `modifyBinary`.
- [x] P1. After writing into an open editor, the view is saved before the engine records anything.
- [x] P4. An open note whose file has a BOM or CRLF line endings, or whose new content does, is written through the Vault API, keeping its bytes exact.
- [x] P3. The snapshot database fails the sync when its upgrade is blocked, closes on `versionchange`, and closes when the plugin unloads.
- [x] P8. A `.json` or `.canvas` file is never merged with markers, even if listed; ticket 08 handles it.
- [x] P9. Engine tests for a note with old markers.
- [x] P6. The line-endings test also asserts the Remote and the other device.
- [x] P10. `TextMerge.conflicted` removed until a ticket needs it.
- [x] S1, S2, S13, S9. Doc comment for `RemoteContent.data`; the glossary's Conflict block entry for the `Remote` label; visible `﻿` escapes; local/Remote vocabulary throughout.
- [x] S5, S6, S8, S10. One strict UTF-8 decode; `nameOf` for the extension; one common-ends helper; text classification next to `RemoteSettings`.
- [x] S7, S14, S3. Shared engine test helpers and Remote read helpers; a path-specific read hook in FakeProvider.
- [x] S11, S12. `recordFile` takes the content with its revision; the typing pause and text classification out of `sync-run.ts`.
