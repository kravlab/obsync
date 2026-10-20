# Plan: 07 Conflict resolution in the editor

Ticket: `.scratch/vault-sync-impl/issues/07-conflict-resolution-in-the-editor.md`
Branch: `feat/conflict-editor`
Status: decisions and test seams approved 2026-10-20

## Decisions

- **Design** (`.scratch/vault-sync/issues/09-inline-conflict-resolution-ui.md`, variant B): markers stay visible as in the file, the two sides get a light tint, and a row of actions sits above the `<<<<<<<` line. Every action is an ordinary edit that the next sync uploads; removing markers by hand works the same way.
- **Conflict-block module** (pure, no Obsidian or CodeMirror): from a note's text to its Conflict blocks, and from a block and an action to the one text edit that resolves it.
  - A marker line is exactly 7 `<`, `=` or `>` at line start, then a space and a label, or the end of the line (a trailing `\r` is allowed). A block is `<<<<<<<`, `=======`, `>>>>>>>` in order; blocks nest. A marker that does not complete a block is plain text: a `>>>>>>>` with no `=======` before it, a second `=======`, an opener never closed. Where the same lines read two ways, a `>>>>>>>` closes the innermost open block that has its `=======`, and an opener never closed takes over the first block inside it; every line stays either way.
  - Every block, inner and outer, gets its own action row; an action replaces that block's lines only, so an inner block stays as it is inside a side it keeps.
  - **Keep <label>** keeps that side; **Keep both** keeps this device's side, then the other's; **Edit…** replaces the block with the text the user saved. A block that ended the note without a line break leaves none behind; a hand edit gets one where the block had one.
  - The buttons are labelled with the labels in the markers ("Keep Laptop", "Keep Remote"); a side whose marker has no label is named "First version" / "Second version" everywhere, its button "Keep first version" / "Keep second version".
- **Editor:** a CodeMirror 6 `StateField` (block widgets must come from a field, not a view plugin), registered with `registerEditorExtension`, recomputed when the document changes. Marker lines and each side get their own line class; the action row is a block widget placed before the `<<<<<<<` line. A click finds the block again in the current document, so it never acts on stale positions.
- **Edit… dialog:** an Obsidian `Modal` showing both sides, labelled, and one text field prefilled with this device's side, then the other's. Save replaces the block; Cancel changes nothing.
- **Phones:** when `Platform.isPhone`, the action row gets a class that makes its buttons at least 44 px tall.
- **Reading view:** a Markdown post-processor. Through `getSectionInfo`, the section holding a block's `<<<<<<<` line is replaced by an "Unresolved conflict" panel rendering both sides as Markdown with their labels and no buttons; the block's other sections are hidden. A section without section info is left as it is. Checked by hand, since the documentation does not say how sections are split.
- **Commands:** "Next conflict" and "Previous conflict" move the cursor to the start of the next or previous block's `<<<<<<<` line in the open note, wrapping around; a note without blocks shows a short notice.
- **CodeMirror:** `@codemirror/state` 6.7.6 and `@codemirror/view` 6.43.13 as pinned devDependencies, the versions the `obsidian` package declares; esbuild keeps them external, so Obsidian's copies run.
- **Strings:** EN and RU for the actions, the dialog, the panel, the commands and the notice.
- **Review:** one code review at the end.

## Test seams

1. Conflict-block module: text to blocks (labels, sides, lines; nested and malformed markers, CRLF), the edit of each action, and the next or previous block from a line. Misses the editor and Obsidian.
2. Editor state field over `EditorState` only (no DOM): which lines are tinted, where the action rows sit, and both updated after edits. Misses rendering, clicks and Obsidian.

The action row's clicks, the dialog, the reading view, the commands and the 44 px buttons are checked by hand on desktop, Android and iOS.

## Steps

- [x] 1. Conflict-block module (seam 1).
- [x] 2. Editor state field and action row widget (seam 2).
- [x] 3. Shell: edit dialog, reading-view post-processor, commands, phone class, styles, EN/RU strings, wiring in `main.ts`.
- [x] 4. Full test run, typecheck, lint, build with a stand-in key.
- [x] 5. Code review, commit, ticket closed.

## Review fixes

Chosen by the user on 2026-10-20 from the step 5 review. Each fix is test-first where it changes behaviour. P3 (reading view may reuse sections it rendered before, so an edit to a later part of a block, or deleting only its `<<<<<<<` line, may show stale or hidden text) is kept as a manual check.

- [x] P1, P5. An opener never closed no longer takes the markers after it: the block around it matches them, and the stray line stays text in its side. Tests for that, empty sides and CRLF resolution.
- [x] P2. The Edit… dialog acts only on the block that was clicked, at its place; if it is gone when Save is pressed, the dialog stays open with a notice, so the typed text is kept.
- [x] P4. Marker lines are kept from being shown as a heading or a quote in Live Preview (manual check).
- [x] P6. The outer tint stays under a nested block; the dialog and the panel name an unlabelled side as the buttons do.
- [x] S1, S2, S3. The action row built from the view's own window; `--font-semibold`; doc comments on the class constants and on `save` and `cancel`.
- [x] S4, S5, S6. One helper for the sides of a block and exported side classes; one label-or-fallback function; finding a block again in the Conflict-block module.
- [x] S7, S8. One direction type; moving between blocks in `src/ui`.
- [x] S9, S10. Shared marker constants for the merge and the parser; the test helper's doc comment.
