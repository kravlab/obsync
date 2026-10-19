# 03: Two-way sync of new and changed files

Parent spec: `.scratch/vault-sync/spec.md`, sections "Remote layout and change detection", "Concurrency and the no-loss guarantee" and "Provider contract".

**What to build:** After connecting, "Sync now" makes new and edited files appear on the other device. A note edited on desktop shows up on the phone after a sync there, and vice versa. Only non-conflicting changes are in scope here. The status entry point shows "Syncing…" and "Synced".

**Blocked by:** 02 (Connect and disconnect Dropbox).

**Status:** resolved

- [ ] The engine lists the Remote, compares it with the Sync snapshot by revision token and the vault by its own content hash, then uploads local changes and downloads remote ones.
- [ ] Every `write` carries the conditional-write precondition (Dropbox upload `update` mode with the known `rev`, or "absent" for new files).
- [ ] The Sync snapshot is updated per file only after both sides confirm the result.
- [ ] The Metadata folder is excluded from the vault comparison.
- [ ] Connecting to a provider that does not report the conditional-write Capability is refused with an explanation.
- [ ] The Dropbox provider implements `list`, `read`, `write` and `createFolder`, with errors mapped to the ten categories. It passes the shared contract suite.
- [ ] Engine tests with two devices on one FakeProvider show edits flowing both ways with no loss.

## Comments

- 2026-10-19: Implemented in commit `e46a4a7` (feat(sync): sync new and changed files both ways) on `main`; plan: `.scratch/vault-sync-impl/plans/03-two-way-sync.md`. Ticket closed.
