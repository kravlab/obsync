# 09: Deletions and the Deletion guard

Parent spec: `.scratch/vault-sync/spec.md`, "Deletions and renames" (deletions, Deletion guard) and "Concurrency and the no-loss guarantee" (folder deletion).

**What to build:** A file deleted on one device is deleted on the others, into the user's Obsidian trash. A file deleted on one device but edited on another comes back everywhere, with a notice. A sync that would delete many files, a large share of the vault, or the whole vault or Remote stops and asks: apply, restore, or review the list.

**Blocked by:** 03 (Two-way sync of new and changed files).

**Status:** ready-for-agent

- [ ] Deletions are detected from the Sync snapshot, with no tombstones on the Remote.
- [ ] A remote deletion is applied with `FileManager.trashFile`. A local deletion is applied on the Remote with `delete` and the `parent_rev` precondition.
- [ ] Edit beats delete, with a notice.
- [ ] A folder is removed only after its known files, and only if a listing shows it empty. A file another device added meanwhile survives.
- [ ] The Deletion guard prompt (apply / restore / review list) appears above N files or P% in either direction, and always for a missing vault or Remote root. N and P are settings.
- [ ] The `delete_v2` response to a `parent_rev` mismatch is confirmed and mapped to `preconditionFailed`.
- [ ] Engine tests cover delete propagation, delete versus edit, folder delete racing an add, and guard thresholds.
