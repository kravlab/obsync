# No test notices the engine taking its own renames for the user's

Status: moved

## Problem

The engine ignores the rename events its own vault renames cause
(`src/engine/engine.ts`, `ownRenames` and `isOwnRename`): they are not
the user's, so they must not become rename hints. With `isOwnRename`
made to answer false every time, all 515 tests under `test/engine` and
`test/plugin` still passed (run after step 13a of
`.scratch/check-automation/plan.md`).

Two things stand in the way of such a test:

- the engine's fake vault (`test/fakes/fake-vault.ts`) tells a renamed
  folder's rename in one event, while Obsidian, and now the fake
  Obsidian vault (`test/fakes/obsidian-app.ts`), tell one more for each
  folder and file inside it, all before the rename resolves;
- from reading the code, a hint left by the engine's own rename seems to
  change nothing a test can see: the next sync's snapshot already holds
  the new paths, and the extra sync it might start is only scheduled
  when no write of the engine's is under way. Not tested.

## To decide

Whether `isOwnRename` guards against something a user can meet; if so,
a test that shows it (with `fake-vault.ts` telling the events inside a
folder as Obsidian does); if not, whether the guard is needed.

## Comments

- 2026-11-04: moved to GitHub issue #4.
