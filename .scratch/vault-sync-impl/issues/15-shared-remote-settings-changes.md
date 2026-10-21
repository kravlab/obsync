# 15: Shared Remote settings changes

Parent spec: `.scratch/vault-sync/spec.md`, "Concurrency and the no-loss guarantee" (shared Remote settings, devices).

**What to build:** From settings, the user changes the shared Remote settings: name policy, text-extension list, ignore list and size ceiling. The change takes effect on every device. If two devices change a setting at once, sync stops until the user picks the value. Changing the name policy renames the affected files on the Remote. The user can also rename this device and forget a device that will never return.

**Blocked by:** 12 (Synced file scope rules).

**Status:** ready-for-agent

- [ ] Shared settings are re-read at the start of every sync. A change is written with a conditional-write precondition.
- [ ] A collision between two changes stops sync and asks the user to choose.
- [ ] Changing the name policy is an explicit operation that renames the affected files on the Remote, and an interruption mid-way completes on the next sync.
- [ ] The device name is editable, and conflict labels and messages use it.
- [ ] "Forget this device" removes that device's record.
- [ ] Engine tests cover settings propagation, collision, and an interrupted name-policy change.

## Comments

- 2026-10-21, from ticket 11 (First sync): two devices setting up one empty Remote at once write `settings.json` only if absent, so the first one wins. Today every device writes the defaults, so the values cannot differ. Once this ticket lets the user choose settings before or while connecting, differing values from such a simultaneous setup must also stop sync until the user picks the value (map ticket `.scratch/vault-sync/issues/12-first-sync-against-existing-remote.md`, point 7).
- 2026-10-21, from ticket 11 (First sync): a device that lost its Sync snapshot registers again under a new Device ID and leaves its old record in the Metadata folder. The spec says that record "ages out" under the inactive-device rule. That rule is not built yet; it belongs with "Forget this device" here.
