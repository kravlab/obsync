# Deletions and renames

Type: grilling
Status: resolved
Blocked by: 04

## Question

How are deletions and renames carried between devices without losing data? Decide: how a device tells "deleted elsewhere" from "never synced here" (tombstones in the Metadata folder, the Sync snapshot, or the Remote's trash), what happens when one side deletes and the other edits, whether a rename is propagated as a move or as delete + create, how a rename on one side meets an edit on the other, and what guard stops a mass deletion (e.g. a vault wiped on one device) from spreading to the Remote and all other devices. Builds on [Remote layout and change detection](04-remote-layout-and-change-detection.md): changes are found by a full listing or change feed compared with the Sync snapshot, folders are mirror entries, and plugin data may live only in the Metadata folder. Per the [Provider contract](05-provider-contract.md), file move and folder move are optional Capabilities; without them the engine moves file by file (write new, then delete old) and must finish an interrupted move on the next sync. Listing entries may carry an optional stable id as a rename hint.

[Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md) already fixes two things here:

- a folder is removed only after its known files are deleted and a listing shows it empty;
- on providers without conditional writes, every delete is recorded in the deleting device's Device journal, which may serve as the tombstone record.

## Answer

Decided in a grilling session. New glossary term: Deletion guard.

1. **Detecting deletions.** By the Sync snapshot. A path recorded there that is now missing from the Remote was deleted remotely; one missing locally was deleted on this device. A path not in the Sync snapshot is new. No separate tombstones are kept on the Remote. Device journals, on providers without conditional writes, still guard against races. A device with no Sync snapshot is handled by [First sync against an existing Remote](12-first-sync-against-existing-remote.md).
2. **Delete versus edit: the edit wins.** The file is restored on every device, and the user sees a notice that the deleted file came back because it was edited on another device, named.
3. **Applying a remote deletion locally** goes through `FileManager.trashFile`, which follows the user's Obsidian trash setting (system trash, `.trash`, or permanent). On the Remote a delete is an ordinary `delete`, which lands in the provider's own trash where it has one.
4. **Deletion guard.** A sync stops and asks the user when it would delete more than N files or more than P% of the vault, in either direction. The user can apply, restore or review the list. N and P are configurable, with defaults left to the spec. A missing vault or a missing Remote root always stops sync.
5. **Detecting renames:**
   - Local: the `rename` event while Obsidian runs. Otherwise a vanished path and a new path with the same content hash, matching uniquely.
   - Remote: the listing's stable id when the provider gives one, otherwise the same content-hash match.
   - An ambiguous match is treated as a delete plus a create.
6. **Applying renames:**
   - A remote rename is applied locally with `vault.rename`, which changes only the path. `FileManager.renameFile` is not used, because it would rewrite links again on every device; the renaming device's own link rewrites arrive as ordinary edits.
   - On the Remote a rename uses the move Capability where available, otherwise write-new then delete-old, per [Provider contract](05-provider-contract.md).
7. **Rename versus edit or delete.**
   - Rename plus an edit elsewhere: the file ends up at the new path with the edit. If both sides changed the content, the conflict policies apply.
   - Rename plus a delete elsewhere: the file stays at its new path, and the user is notified. A rename is a deliberate action, like an edit.
8. **Two different renames of the same file.** The name already on the Remote wins. The detecting device renames its file to match and shows a notice naming both names. No content is lost.
9. **Folder renames** count as renames of every file and subfolder inside, each following points 7–8. On the Remote one folder move is used when the provider has the Capability and nothing inside conflicts; otherwise the engine works file by file.
10. **Rename onto an occupied path.** When the target path has meanwhile been taken by a different file from another device, the Remote file keeps the path and the renamed local file becomes a Conflict copy next to it. The user is notified.
