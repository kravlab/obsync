# Status and notices UI

Type: prototype
Status: resolved
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

## Answer

Decided by reacting to a three-variant prototype on branch `prototype/status-and-notices-ui` (local, never merged), file `.scratch/vault-sync/prototypes/status-and-notices-ui/index.html`. The variants were:

- A: status bar + Sync window;
- B: Sync side panel;
- C: minimal icon + commands.

Variant A won.

1. **Entry points:**
   - **Desktop:** one status bar item showing a state dot, the state ("Synced", "Syncing…", "Offline", "Reconnect needed", "Paused: confirm deletions") and the counts of conflicts and skipped files. A click opens the Sync window.
   - **Mobile:** "Custom status bar items are not supported on Obsidian mobile apps" (Obsidian developer docs, Status bar), so the entry point is a ribbon icon that opens the same window. The probe's ribbon icon was visible on both Android and iOS in [Mobile runtime checks](17-mobile-runtime-checks.md). Whether the icon can change at runtime to show the state is left to the spec.
   - **Everywhere:** "Sync: …" commands in the command palette, because users can hide the ribbon.
2. **The Sync window** shows the state, a "Sync now" or "Reconnect" button, and three tabs:
   - **Conflicts:** files with Conflict blocks, Conflict copies, and configuration conflicts with "Restore local";
   - **Skipped:** each file with its reason;
   - **Activity:** a short log of the last N events in user terms, with "Copy for a bug report". N is left to the spec.
3. **Prompts are modal dialogs**, with buttons at least 44 px tall on phones:
   - the Deletion guard: apply, restore, review list;
   - the First sync preview: summary, full list, the bulk "Remote + Conflict copies" option;
   - "another device's First sync is in progress": wait, or continue anyway;
   - the onboarding screen.
4. **Notices** are transient pop-ups, and each one also goes to the Activity log:
   - restored after delete;
   - renamed to the Remote name;
   - settings updated, restart needed;
   - Conflict copy created;
   - reconnect needed.
5. **Texts** are in English and Russian, chosen by Obsidian's language. Help opens from the Sync window and from settings.
