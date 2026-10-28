# Plan: 15 Shared Remote settings changes

Ticket: `.scratch/vault-sync-impl/issues/15-shared-remote-settings-changes.md`
Parent spec: `.scratch/vault-sync/spec.md`, "Concurrency and the no-loss guarantee" (shared Remote settings, devices)
Branch: `feat/shared-settings` (new, from `main` at `a64ac66`)
Status: plan and decisions approved 2026-10-28

## Facts checked

- **Settings today.** Only `connect` writes `settings.json` (`src/engine/connection.ts`): the defaults, with an `absent` precondition. Every sync reads it (`readRemoteSettings`, `engine.ts`), without its revision.
- **Device name.** Conflict labels and Conflict copy names already take `connection.device.name` (`sync-run.ts`). The device record in the Metadata folder holds `deviceName`; `firstSyncInProgress` shows it.
- **Holds.** `SyncHold` already covers the Deletion guard and First sync; a settings collision follows that pattern.
- **Feed state.** `RemoteFeed` holds vault paths decoded under the name policy in force when it was stored (ticket 12 comment).
- **No renames possible on a name-policy change.** The encoding changes only characters the provider cannot store and refuses a vault name already holding a substitute, so a Remote name affected by the change has no representable name under the new policy.

## Decisions (approved)

1. **Editing.** Settings get a section for all devices: name policy, text extensions, ignore list (one pattern per line), size ceiling in whole MiB, at least 1 (a sync applies at most the provider's `maxFileSize`), applied with one "Apply to all devices" button. The fields show the values the last sync read, stored on the device (values only: the merge needs no revision), or those a waiting change asks for.
2. **Pending change.** The button stores the change on the device, durably (the values the tab's edits started from and the wanted values), and starts a sync.
3. **Applied inside the sync.** After `settings.json` is read again, each setting merges three-way: Remote unchanged takes mine, mine unchanged takes the Remote's; both changed differently is a collision. The write carries a `revision` precondition; on `preconditionFailed` the settings are read again and merged again. Different settings changed on two devices merge without asking.
4. **Collision.** Sync stops and a prompt asks, per colliding setting, mine or the Remote's. Closed without an answer, sync is held with the new status `settingsCollision` until the user syncs again, which asks again.
5. **Name-policy change.** Before writing, the sync lists the Remote in full. If any file's name would become unrepresentable or ambiguous under the new policy (encode→skip: encoded names; skip→encode: names already holding a substitute), the change is refused: a new notice lists those files, also kept in the activity log; the pending policy change is dropped, the other settings still apply. An accepted change makes every device list the Remote in full once when it sees another policy, as on `cursorLost` (`RemoteFeed` is stamped with its policy). No files are renamed. A file another device uploads with an encoded name between the check and the write gives a duplicate, never a loss.
6. **Device name.** Editable in settings; stored in the Connection at once; the device record on the Remote is rewritten after the next completed sync. New labels and messages use it; existing Conflict blocks keep theirs.
7. **Forget a device.** Settings list the other devices' records (name and "Forget", confirmed); Forget deletes `devices/<id>.json` with a `revision` precondition. This device cannot forget itself. No automatic ageing: until Device journals exist, records hold nothing back. The inactive-device threshold is noted on the ticket as deferred.
8. **Ticket 11 comment** (differing values on simultaneous setup) does not apply: this ticket does not let settings be chosen while connecting, so `connect` still writes the defaults.
9. **Documentation.** The ticket's criterion and the spec's line on renames on a name-policy change follow decision 5. Strings in English and Russian.
10. **Review.** One `code-review` at the end, as the repository's `/implement` asks.
11. **Branch.** `feat/shared-settings`. The uncommitted devcontainer changes in the working tree are not this task's and are never staged.

## Steps

- [x] 1. `remote-metadata`: settings read with their revision, conditional write, listing device records, deleting one.
- [x] 2. Pure functions: the per-setting three-way merge; the representability check of a name-policy change over a listing.
- [x] 3. Device store: last-read settings with revision, the pending change, `RemoteFeed` stamped with its policy, the outdated device-record flag (fake first, then Obsidian).
- [x] 4. Engine: applying the change, collision prompt and hold, refusal of a policy change, the full listing after one, rewriting the device record; new status, notice and hold.
- [x] 5. `ConnectionService`: `renameDevice`, `listDevices`, `forgetDevice`.
- [x] 6. Shell: settings section, collision modal, status and notice texts, en/ru, `main.ts` wiring.
- [x] 7. Multi-device engine tests: propagation, collision, different settings merged, policy change refused and accepted with a full listing after, device rename and forget.
- [x] 8. Documentation (ticket, spec), full tests and checks, `code-review`, close the ticket, commit. All review findings were fixed or settled by choice on 2026-10-28: the tab passes the settings its edits started from (`changeSettings(base, wanted)`) and follows each completed sync unless being edited, a change joining one being written is rebased onto it, the First sync's end keeps a rename made meanwhile (`updateDeviceRecord`), the heading avoids "settings", the four prompt modals share `PromptModal`, `MEBIBYTE` is shared, and the missing tests were added; decisions 1 and 2 were reworded (no revision stored, the ceiling capped by the sync).
