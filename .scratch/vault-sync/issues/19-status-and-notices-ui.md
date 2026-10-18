# Status and notices UI

Type: prototype
Status: open
Blocked by: none

## Question

How do the plugin's status and notices look and behave? All the behaviour is already decided on the map; what remains is the form. Prototype variants (as was done for [Inline conflict resolution UI](09-inline-conflict-resolution-ui.md)) and decide:

- **Status indicator:** synced, syncing, offline, paused for "reconnect needed", and the count of conflicts and skipped files. Desktop status bar; on mobile, wherever it is visible.
- **The single conflict list,** covering files with Conflict blocks, Conflict copies, and configuration conflicts restorable from the plugin folder ([Text conflict merge policy](07-text-conflict-merge-policy.md), [Binary conflict policy](08-binary-conflict-policy.md), [Synced file scope](11-synced-file-scope.md)).
- **The list of skipped files:** dot-paths, ignore list, size ceiling, names that cannot be mirrored.
- **The Deletion guard prompt** (apply / restore / review list) from [Deletions and renames](10-deletions-and-renames.md).
- **The First sync preview** (summary, full list, the bulk "Remote + Conflict copies" option) from [First sync against an existing Remote](12-first-sync-against-existing-remote.md).
- **Notices:**
  - restored after delete;
  - renamed to the Remote name;
  - settings updated, restart needed;
  - Conflict copy created;
  - another device's First sync is in progress;
  - reconnect needed.
- **The onboarding screen and the help section** from [Conflict-avoidance guidance for users](18-conflict-avoidance-guidance.md), in English and Russian.
- **The sync log:** whether there is one for the user, and what it shows.

Each must work on phone screens. Uses the vocabulary in `GLOSSARY.md`.
