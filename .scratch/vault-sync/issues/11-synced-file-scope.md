# Synced file scope

Type: grilling
Status: open
Blocked by: 02, 17

## Question

Which files does the plugin sync? Decide whether the vault configuration folder (`.obsidian/`: settings, plugins, themes, workspace layout) is synced in whole, in part or not at all, and how per-device files (e.g. workspace layout) are kept apart; the default ignore list and how the user edits it; that the plugin's own state never syncs; hidden files; and whether there is a file size ceiling. Depends on what the API can see, per [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md). Each provider reports its maximum file size, and transfers are whole buffers held in memory ([Provider contract](05-provider-contract.md)).

Per [Mobile runtime checks](17-mobile-runtime-checks.md), whole files up to 100 MB were handled in memory on Android and iOS, and every HTTP request stays below a per-request limit (under 20 MB by default, user-configurable), so the file size ceiling is not bound by a single request.
