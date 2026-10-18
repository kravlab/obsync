# 14: Sync window, notices and reconnect

Parent spec: `.scratch/vault-sync/spec.md`, "Status, notices, guidance".

**What to build:** The user always sees the sync state and can reach everything sync-related:

- **Desktop:** a status bar item with a state dot, the state, and the conflict and skipped counts.
- **Mobile:** a ribbon icon, since custom status bar items are not supported on Obsidian mobile.
- **Everywhere:** "Sync: …" commands.

All three open a Sync window with Conflicts, Skipped and Activity tabs. Notices pop up and are also kept in the activity log. An expired login pauses sync on that device with a "Reconnect needed" state.

**Blocked by:** 08 (Conflict copies for binary and JSON files), 12 (Synced file scope rules).

**Status:** ready-for-agent

- [ ] The status entry points show these states: Synced, Syncing…, Offline, Reconnect needed, Paused (confirm deletions). Whether the ribbon icon can show the state at runtime is checked and, if it can, implemented.
- [ ] The Sync window's Conflicts tab lists files with Conflict blocks (opening at the first block), Conflict copies, and restorable configuration conflicts. The Skipped tab gives each file with its reason. The Activity tab shows the last N events in plain words with "Copy for a bug report".
- [ ] Notices cover: restored after delete, renamed to the Remote name, settings updated so a restart is needed, Conflict copy created, reconnect needed. Each also appears in the activity log.
- [ ] An `auth` error pauses sync on that device only, with one notice and a persistent "Reconnect needed" state. Reconnecting to the same account continues with a normal sync, not a First sync.
- [ ] Modals have buttons at least 44 px tall on phones. All texts are in English and Russian.
- [ ] Manual check on desktop, Android and iOS.
