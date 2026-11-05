# Typing in an open editor is not covered by a test

Status: moved

## Problem

`src/obsidian/local-vault.ts` records the user's typing in an open note
(`noteTyped`, called on each `editor-change`) and ignores the changes it
makes itself while it updates the editor (`writingEditor`). It also
refuses to replace a note whose editor holds keystrokes not yet saved.
No test covers any of this: `noteTyped` appears in no test, and the file
has no unit test of its own.

So a change that dropped the `writingEditor` guard, and made the plugin
take its own write for typing, would pass every test. The same holds for
a change that let a sync overwrite unsaved keystrokes.

Found in the review of step 10 of `.scratch/check-automation/plan.md`
(check 7, the cursor). Check 7 asks only that the note is updated in
place and the cursor keeps its place, so this stays out of that step.

## What a test could do

With the fake editor of step 10 (`FakeWorkspace.openInEditor`, the fake
`Editor` and `MarkdownView`), through the whole plugin:

- type into an open note with `editor.replaceRange` and check that the
  sync waits for the edit pause before sending it;
- type without saving, change the note on the other device, sync, and
  check that the keystrokes are kept;
- update an open note from the other device and check that the update
  is not recorded as typing.

## To decide

Whether `editor-change` fires synchronously inside Obsidian's
`replaceRange`: the `writingEditor` guard depends on it, and the fake
assumes it. The desktop run (step 13) can observe it.

## Comments

- 2026-11-04: moved to GitHub issue #1.
