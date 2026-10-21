# Text merge speed for edits far apart

Status: approved 2026-10-21

## Problem

The test "merges edits at both ends of a 5,000-line note within a second"
(`test/engine/text-merge.test.ts`) fails now and then in a full run
(1,846 ms measured), and the `pre-commit` hook then refuses the commit.
Alone it takes 380–640 ms, so the merge itself is slow, not the test.

The text merge keeps the lines all versions share at both ends out of the
diff (`src/engine/text-merge.ts`, `regions`), but two edits far apart leave
almost the whole note in between. `node-diff3` (3.2.1, the latest) diffs
it with Hunt–Szymanski, whose `LCS` looks for the candidate a match
extends by scanning the candidate list one by one (`for (s = r; s <
candidates.length; s++)`) instead of searching it in halves. For two
versions of mostly distinct lines that makes the diff about quadratic:
roughly 12.5 million steps for 5,000 lines. Upstream knows the slowness
(node-diff3 issue #84, "Poor performance", open since 2024-08) and has no
fix.

On a phone the same merge is slower still, so a user with a long note
edited at its start on one device and at its end on another waits.

## Behaviour

1. `node-diff3` is patched with `pnpm patch` (the patch file in
   `patches/`, recorded in `pnpm-workspace.yaml`): in `LCS` the scan for
   the candidate becomes a binary search over the same candidates, which
   the algorithm keeps sorted by their position in the second sequence.
2. Every build of the package that holds `LCS` is patched the same way:
   `dist/diff3.mjs`, `dist/diff3.cjs`, `dist/diff3.iife.js`,
   `src/diff3.mjs`.
3. The search finds exactly the candidate the scan found, so every diff
   and merge result is unchanged; only its cost drops, to about n log n.
4. Nothing in the plugin's code changes, apart from the comment in
   `regions` that names the cost.

## Tests

- New: edits at both ends of a 20,000-line note merge within a second
  (quadratic today: several seconds, so it fails before the patch).
- The existing merge tests pass unchanged, proving the results are the
  same.
- Checked once outside the repository: the patched and the original `LCS`
  give the same result on many generated sequence pairs (fixed seed).
- The full suite passes three times in a row before any commit.

## Out of scope

- Offering the fix upstream to node-diff3.
- Replacing node-diff3.
