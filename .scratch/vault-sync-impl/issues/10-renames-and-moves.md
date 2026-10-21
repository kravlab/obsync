# 10: Renames and moves

Parent spec: `.scratch/vault-sync/spec.md`, "Deletions and renames" (rename detection, applying renames, combinations, folder renames).

**What to build:** Renaming or moving a file or folder on one device renames it on the others, without re-uploading it and without rewriting links again on every device.

- A rename that meets an edit elsewhere keeps both the new name and the edit.
- A rename that meets a delete keeps the file under the new name.
- Two different renames settle on the Remote's name, with a notice.
- A rename onto a path another device just used keeps both files.

**Blocked by:** 06 (Text merge and Conflict blocks), 09 (Deletions and the Deletion guard).

**Status:** resolved

- [ ] Detection works from the `rename` event while running, or offline from a unique content-hash match; on the Remote, from the stable id or a hash match. An ambiguous match is treated as delete plus create.
- [ ] Remote renames are applied locally with `vault.rename`, never `FileManager.renameFile`. On the Remote the move Capability is used where available; otherwise write-new then delete-old, ordered so an interrupted move completes on the next sync.
- [ ] Combinations behave as in the spec: rename plus edit, rename plus delete, two different renames, rename onto an occupied path giving a Conflict copy.
- [ ] Folder renames carry their contents, using one folder move when the provider supports it and nothing inside conflicts.
- [ ] Engine tests cover each combination, offline renames, and an interrupted move.

## Comments

- 2026-10-21: Implemented in commit `347381b` (feat(sync): carry renames and moves) on `feat/renames`; plan: `.scratch/vault-sync-impl/plans/10-renames.md`. Ticket closed. Dropbox `move_v2` and stable ids are in this ticket; a name that changed only in case is followed on this device only (Dropbox cannot move it). Whether Dropbox keeps a moved file's `rev` is not documented; the engine does not rely on it. Still to check by hand in Obsidian: the rename events of a folder rename, and the notices.
