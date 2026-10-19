# 06: Text merge and Conflict blocks

Parent spec: `.scratch/vault-sync/spec.md`, "Text merge" and "Concurrency and the no-loss guarantee".

**What to build:** When a note is edited on two devices, edits to different parts merge automatically. Overlapping edits become a Conflict block in the note, labelled with the device names, so nothing is lost. The note being typed in is merged only after a typing pause.

**Blocked by:** 03 (Two-way sync of new and changed files).

**Status:** resolved

- [ ] A per-device Base, the content at the last successful sync, is stored in the Device store and drives a line-based 3-way merge. The merge library is pure JavaScript and runs on mobile.
- [ ] Conflict blocks use git syntax, labelled with this device's name and the other device's name, or `Remote` when it is unknown.
- [ ] Without a true Base, a 2-way merge marks every differing region and never picks a side. Identical versions are no conflict.
- [ ] Versions are compared and merged with LF and no BOM; the result is written in the local file's style.
- [ ] Text means an extension from the shared text-extension list plus a UTF-8 check on all three versions.
- [ ] A `preconditionFailed` on upload re-reads the Remote version and merges.
- [ ] Old markers merge as plain text.
- [ ] Remote changes to the note open in the editor are applied after the typing pause, without moving the cursor.
- [ ] Engine tests cover clean merge, conflicting merge, missing Base, line-ending-only differences, and concurrent writes from two devices.

## Comments

- 2026-10-19: Implemented in commit `fb80a60` (feat(sync): merge notes edited on two devices) on `feat/text-merge`; plan: `.scratch/vault-sync-impl/plans/06-text-merge.md`. Ticket closed. Still to check by hand in Obsidian: writing into an open note keeps the cursor and is saved, the typing tracker, and the snapshot database upgrade. Applying a change once the typing pause has passed waits for a later sync until ticket 05 adds the trigger.
