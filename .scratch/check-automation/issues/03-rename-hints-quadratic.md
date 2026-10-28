# Finding a folder's renames takes time quadratic in its files

Status: needs-triage

## Problem

Obsidian tells a renamed folder's rename once for the folder and once
for each folder and file inside it (seen in the desktop run,
`test/e2e/desktop/folder-rename-events.test.ts`), and the plugin passes
each on to the engine as a rename hint (`src/obsidian/local-vault.ts`,
`src/engine/engine.ts`, `renameHints`). A folder of n files gives n + 1
hints.

`renamedHere` (`src/engine/renames.ts`) calls `followMoves` over every
hint for each path of the snapshot that is gone from the vault, so a
renamed folder of n files costs about n² steps.

Found in the review of step 13a of `.scratch/check-automation/plan.md`,
from reading the code: no test measures it, and no time was taken.

## To decide

Whether it matters at the folder sizes users have; if so, how to follow
the hints in one pass (for example, dropping hints that a folder's own
hint already covers).

## Comments
