# The fake Obsidian vault renames onto an existing path, or into itself

Status: needs-triage

## Problem

`FakeObsidianVault.rename` (`test/fakes/obsidian-app.ts`) checks neither
the target nor where it lies:

- renaming `Box` (holding `x.md`) to an existing `Box2` (holding its own
  `x.md`) succeeds and replaces `Box2/x.md` with `Box/x.md`;
- renaming `Box` into its own subfolder `Box/Sub`, when `Box/Sub` holds
  files, fails with `fake vault: nothing at Box/Sub` and leaves the
  entries as `Box/Sub/x.md`, `Box/Sub/Sub`, `Box/Sub/Sub/y.md`.

Both were run against the fake after step 13a of
`.scratch/check-automation/plan.md`. The engine's own fake
(`test/fakes/fake-vault.ts`) rejects a rename onto an existing path.

A test that renames onto a taken path through the whole plugin would see
a quiet overwrite where Obsidian behaves otherwise.

## To decide

What Obsidian's `vault.rename` does in both cases: not observed yet. The
desktop run (`test/e2e/desktop/`) can record it, offline, as it recorded
a folder's rename events; the fake then does the same.

## Comments
