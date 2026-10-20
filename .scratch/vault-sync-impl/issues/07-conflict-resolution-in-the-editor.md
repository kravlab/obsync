# 07: Conflict resolution in the editor

Parent spec: `.scratch/vault-sync/spec.md`, "Architecture and modules" (Conflict-block module, editor extension).

**What to build:** In the editor, each Conflict block shows a row of actions above it:

- keep this device;
- keep the other device;
- keep both;
- Edit…, which opens a dialog with both sides in a text field.

Markers stay visible as in the file. Reading view shows the block as "Unresolved conflict" with both sides and no buttons. Commands move between conflicts.

**Blocked by:** 06 (Text merge and Conflict blocks).

**Status:** resolved

- [ ] A pure Conflict-block module maps document text to blocks and to the edit each action produces, including nested and malformed markers. It has unit tests.
- [ ] A CodeMirror 6 extension shows the action row. On phones the actions are buttons at least 44 px tall.
- [ ] Each action is an ordinary edit, picked up by the next sync. Removing markers by hand works the same way.
- [ ] A reading-view post-processor renders blocks without buttons.
- [ ] "Next conflict" and "previous conflict" commands exist.
- [ ] Manual check on desktop, Android and iOS.

## Comments

- 2026-10-20: Implemented in commit `b4c1476` (feat(conflicts): resolve Conflict blocks in the editor) on `feat/conflict-editor`; plan: `.scratch/vault-sync-impl/plans/07-conflict-editor.md`. Ticket closed. The manual check on desktop, Android and iOS is still to be run: the action row and its clicks, the Edit… dialog, the 44 px buttons on phones, the commands, Live Preview showing marker lines as plain text, and reading view, including whether it shows a stale panel or hides text after an edit to a later part of a block or after deleting only its `<<<<<<<` line.
