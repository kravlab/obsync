# Concurrent sync from several devices

Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

What happens when two devices sync against the same Remote at the same time, for example both upload a new version of the same note, or one deletes a folder while the other writes into it? Decide whether the engine relies on conditional writes, a lock or lease on the Remote, re-check-after-write, or accepts a window of risk, and what guarantee the user gets ("no change is ever silently lost" or something weaker). Must work on providers that lack conditional writes, and Google Drive, one of the candidate first providers, is one of them: it has no documented conditional write and allows duplicate names (see [Provider capabilities survey](01-provider-capabilities-survey.md)). Any coordination data (leases, device records) can live only in the Metadata folder, and there is no shared manifest on the Remote ([Remote layout and change detection](04-remote-layout-and-change-detection.md)). The [Provider contract](05-provider-contract.md) offers an optional "only if revision is X / only if absent" precondition on write and delete, usable only when the provider reports the conditional-write Capability and never emulated by the provider.

## Answer

Decided in a grilling session; the mechanism choice is recorded in `docs/adr/0003-device-journals-instead-of-locks.md`. Glossary: new term Device journal, and Device now carries a Device ID and a device name.

1. **Guarantee: no change is ever silently lost, on any provider.** Every version any device writes either stays on the Remote or is preserved by merging, or by the conflict policies of [Text conflict merge policy](07-text-conflict-merge-policy.md) and [Binary conflict policy](08-binary-conflict-policy.md).
2. **Providers with the conditional-write Capability.** Every `write` and `delete` carries the precondition "revision is what my Sync snapshot recorded" or "absent". A `preconditionFailed` result makes the engine re-read the file and treat it as a conflict. No other coordination is used.
3. **Providers without conditional writes** (for example Google Drive, some WebDAV servers) use **Device journals**. Each device keeps one journal file in the Metadata folder, and only that device writes it. A write goes in three steps:
   1. append an intent: "writing X over revision P";
   2. write the file;
   3. complete the entry with the resulting revision R.

   An interrupted write is therefore still visible to the other devices.

   When a device finds in another journal that a revision it wrote was overwritten by a write based on an older revision, it merges its local version with the current one on its next sync, using the conflict policies. Where the common ancestor's content is not available, the "missing base" rule of [Text conflict merge policy](07-text-conflict-merge-policy.md) applies. Until that repair runs, other devices may briefly see a version without the overwritten change.

   A revision that appears in no journal is treated as an outside edit, handled best effort.
4. **Devices.** Each device has a random Device ID, created on first connect and stored only on the device, and a user-editable device name. Both are recorded in the Metadata folder. The name is used in messages to the user.
5. **Journal growth.**
   - Each device records in its own journal how far it has read every other journal.
   - An entry is pruned once all active devices have read it.
   - A device that has not synced for N days (N set by the spec) stops holding back pruning, and settings offer "forget this device".
   - Ordering never relies on device clocks, only on revisions and journal links. Clocks serve only for the coarse inactivity check.
6. **Folder delete during a concurrent write.** Deleting a folder deletes the files this device knows about one by one (with preconditions or journal entries), then the folder itself, and only if a listing shows it empty. A file another device added meanwhile survives, keeps the folder, and syncs normally. Provider-side recursive folder delete is never used.
7. **Shared Remote settings** in the Metadata folder (so far only the name policy) change only by explicit user action and are re-read at the start of every sync. A change is written with a precondition where available, otherwise checked against the journals. If two changes collide, sync stops until the user picks the value. Changing the name policy is an explicit operation that renames the affected files on the Remote.
