# First sync against an existing Remote

Type: grilling
Status: resolved
Blocked by: 07

## Question

What happens the first time a device syncs, when there is no common ancestor yet? Cases: empty vault + populated Remote, populated vault + empty Remote, both populated (e.g. a second device that already has a copy of the vault, or a reinstall). Decide how identical files are recognised without a full-file conflict, how differing files are handled, whether the user previews or confirms the first sync, and how a device that lost its Sync snapshot recovers (it starts with a full listing, per [Remote layout and change detection](04-remote-layout-and-change-detection.md)). Uses the merge policy from [Text conflict merge policy](07-text-conflict-merge-policy.md).

Per [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md), a device creates its Device ID and registers itself in the Metadata folder on first connect. Also decide what happens when two devices initialise the same empty Remote at the same time.

[Text conflict merge policy](07-text-conflict-merge-policy.md) already decides the merge itself: with no Base, a 2-way merge turns every difference into a Conflict block, and identical versions are no conflict. This ticket decides when that applies on a first sync and whether the user previews or confirms it.

Per [Deletions and renames](10-deletions-and-renames.md), a device with no Sync snapshot cannot tell "deleted elsewhere" from "never synced". Decide how a first sync treats files present on only one side, and how the Deletion guard applies when a first sync would delete anything.

## Answer

Decided in a grilling session. New glossary term: First sync.

1. **First sync** is any sync by a device with no Sync snapshot for the Remote: a new device, a reinstall, or a lost snapshot. It starts with a full listing.
2. **Union.** A file present on only one side is copied to the other. A First sync never deletes anything, so the Deletion guard has nothing to stop. Known cost: files that another device deleted, but that are still in this device's copy of the vault, come back.
3. **Identical files** are not conflicts; they go straight into the Sync snapshot. Identity is checked with the plugin's own content hash. When the provider reports a server hash in an algorithm the plugin can also compute locally, that hash is used instead of downloading the file, but only on an exact algorithm match. This refines point 7 of [Remote layout and change detection](04-remote-layout-and-change-detection.md), which kept server hashes out of decisions.
4. **Files that differ** follow the normal policies:
   - text: a 2-way merge into Conflict blocks, per [Text conflict merge policy](07-text-conflict-merge-policy.md);
   - JSON and binary: a Conflict copy, with the Remote version keeping the name, per [Binary conflict policy](08-binary-conflict-policy.md).
5. **Preview before anything changes.** The user first sees a summary: files to download, files to upload, identical files, and differing files that will become conflicts, with the full list on request. One bulk alternative is offered: "use the Remote version for every differing file and keep the local versions as Conflict copies", which avoids markers in many notes at once. Nothing changes until the user starts the sync.
6. **A lost Sync snapshot** is handled as a First sync. The device registers again with a new Device ID, and its old record ages out under the N-day inactivity rule from [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md).
7. **Two devices initialising an empty Remote at once.** The shared Remote settings are created with an "only if absent" precondition where available; otherwise the result is checked by listing and through the Device journals. Identical values give one settings record. Different values trigger the settings-collision rule from [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md): sync stops until the user picks. Files themselves merge by the union rule above.
