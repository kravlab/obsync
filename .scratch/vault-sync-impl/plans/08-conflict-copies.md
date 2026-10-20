# Plan: 08 Conflict copies for binary and JSON files

Ticket: `.scratch/vault-sync-impl/issues/08-conflict-copies-for-binary-and-json-files.md`
Branch: `feat/conflict-copies`
Status: plan and decisions approved 2026-10-20

## Decisions

- **Which files get a Conflict copy:** every file whose content kind is not text (spec, "Binary conflicts"), a text-extension file whose versions are not all UTF-8 (`.scratch/vault-sync/issues/08-binary-conflict-policy.md`, item 5), and a `.canvas`/`.json` file whose merge is not clean or does not parse as JSON (spec, "Text merge").
- **JSON merge:** line-based 3-way merge against the Base, as for text. `mergeText` reports whether it wrote Conflict blocks; the result is applied only without blocks and only if it parses as JSON. JSON files get a Base recorded like text files.
- **Who keeps the name:** the Remote version goes into the original file; this device's version becomes the Conflict copy. No clock decides anything.
- **Copy name:** `Name (conflict <device name> YYYY-MM-DD HHmm).ext` in the same folder, split at the last dot of the file's own name; a name without an extension gets no `.ext`. The time is the device clock's local time.
- **Device name in the copy name:** `\ / : * ? " < > |` and control characters are replaced by `-`, in the copy name only.
- **Name taken:** when the name is taken in the vault or on the Remote, ` 2`, ` 3`, … goes inside the parentheses: `Photo (conflict Phone 2026-10-20 1430 2).png`.
- **Recognising copies:** a pure function tells a Conflict copy by its name, numbered ones included, so every device can list them (the list itself is ticket 14).
- **Order:** the copy is written to the vault, uploaded on condition that it is absent, and recorded; then the original is replaced with the Remote version, if the vault file still holds what was copied, and recorded. A sync cut off in between can leave an extra identical copy; nothing is lost. A note being typed into is left for a later sync, as with merges.
- **Notice:** one per Conflict copy, through a new `UiPort.showNotice` with the notice kind `conflictCopyCreated`; EN and RU text. The activity log and the conflict list are ticket 14.
- **Review:** one code review at the end.

## Test seams

1. Conflict-copy module: the copy name from a path, a device name and a time (extension, no extension, several dots, unsafe device-name characters, numbering), and recognising copies by name. Misses the engine.
2. The sync engine through its ports (spec seam 1): binary conflict after edits on both devices, created on both devices with different content, a concurrent write refused by its precondition, JSON clean merge, JSON merge that is not valid JSON, JSON with conflicting edits, identical content, a non-UTF-8 `.md`, a taken copy name, and the notice. Misses the shell's notice.
3. Notice text: the text of `conflictCopyCreated` in EN and RU, as `statusLabel` is tested. Misses Obsidian's `Notice`.

The notice popping up in Obsidian is checked by hand.

## Steps

- [x] 1. Conflict-copy module (seam 1).
- [x] 2. `mergeText` reports whether it wrote Conflict blocks.
- [x] 3. Engine: conflicts by content kind, JSON Base, Conflict copies, the notice through `UiPort` (seam 2).
- [x] 4. Shell: notice text EN/RU (seam 3), wiring in `main.ts`.
- [x] 5. Full test run, typecheck, lint, build with a stand-in key.
- [x] 6. Code review, commit, ticket closed. Review done 2026-10-20; the chosen fixes are below.

## Review fixes

Chosen by the user on 2026-10-20 from the step 6 review (R5, R6 and R10 are kept as they are). Each fix is test-first where it changes behaviour.

- [x] R1, R7. A copy upload refused because its name is taken on the Remote moves the vault copy to the next number and tries again. Tests for that refusal and for the vault file edited while the original is replaced.
- [x] R2. The `conflictCopyCreated` doc no longer claims the Remote version is at `path`.
- [x] R3, R4. After the original takes the Remote version, the sync's Remote listing has that revision, so the download pass does not read the file again; the Remote hash is computed once per merge.
- [x] R8. One helper in `paths.ts` splits a file name at its extension, for Conflict copy names and content kinds.
- [x] R9. Doc comments on `showNotice` in `StatusIndicator` and `RecordingUi`.
