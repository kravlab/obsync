# 11: First sync

Parent spec: `.scratch/vault-sync/spec.md`, "First sync" and "Concurrency and the no-loss guarantee" (device record, First sync mark).

**What to build:** A device without a Sync snapshot (new device, reinstall, lost state) first sees a preview: files to download, files to upload, identical files, and differing files. It also offers the bulk option "Remote version for every differing file, keep mine as Conflict copies". The First sync only adds and merges, never deletes. Other devices connecting meanwhile are warned that a First sync is in progress.

**Blocked by:** 06 (Text merge and Conflict blocks), 08 (Conflict copies for binary and JSON files), 09 (Deletions and the Deletion guard).

**Status:** resolved

- [ ] First sync is a union with no deletions. Differing text gets a 2-way merge with Conflict blocks; differing non-text and JSON files get Conflict copies.
- [ ] The preview modal has counts, a full list and the bulk option. Nothing changes before the user starts the sync.
- [ ] Identical files are matched by the plugin hash. A server hash is used instead of a download only on an exact algorithm match the plugin can compute locally; for Dropbox, its `content_hash`.
- [ ] A lost Sync snapshot leads to a First sync and re-registration under a new Device ID.
- [ ] While running, the device record carries a "First sync in progress" mark. A device connecting meanwhile is told to wait, and may continue anyway. A stale mark expires after a timeout.
- [ ] Two devices initialising an empty Remote at once never corrupt the shared settings. Differing values stop sync until the user picks.
- [ ] Engine tests cover empty vault plus full Remote, full vault plus empty Remote, both full, the bulk option, and simultaneous initialisation.

## Comments

- 2026-10-21: Implemented in commit `acd0340` (feat(sync): preview and run a First sync) on `feat/first-sync`; plan: `.scratch/vault-sync-impl/plans/11-first-sync.md`. Ticket closed. The "First sync in progress" mark holds for 6 hours. Stopping sync until the user picks between differing shared settings from a simultaneous setup is handed to ticket 15 (settings cannot differ before it), and so is the old device record ageing out after a re-registration. Still to check by hand in Obsidian: the preview modal, the connect warning, and an existing install keeping its snapshot after the IndexedDB upgrade.
