# 12: Synced file scope rules

Parent spec: `.scratch/vault-sync/spec.md`, "Synced file scope" (dot-paths, ignore list, size ceiling, name policy).

**What to build:** Only the right files sync:

- hidden dot-paths such as `.git`, `.trash` and `.DS_Store` never do;
- paths matching the shared ignore list are skipped on every device;
- files above the size ceiling (100 MB by default) are skipped;
- names the provider cannot store are skipped and reported, or encoded reversibly if the Remote's name policy says so;
- names that differ only by case on a case-insensitive provider are always skipped.

Every skipped file is listed with its reason.

**Blocked by:** 03 (Two-way sync of new and changed files).

**Status:** resolved

- [ ] Dot-paths are excluded, except the configuration folder, which is handled in ticket 13.
- [ ] The ignore list, size ceiling and name policy are read from the shared Remote settings, so every device applies the same rules.
- [ ] The size ceiling never exceeds the provider's maximum.
- [ ] Provider name rules (forbidden characters, reserved names, length, case-insensitivity) drive the name policy. There is one provider-neutral, strictly reversible encoding. Dropbox case-only collisions are skipped and reported.
- [ ] A skipped-files list with reasons is available to the UI.
- [ ] Engine tests cover each rule, and an excluded path is never treated as deleted.

## Comments

- 2026-10-21: Implemented in commit "feat(sync): apply the Synced file scope rules" on `feat/file-scope`; plan: `.scratch/vault-sync-impl/plans/12-file-scope.md`. Ticket closed. The ignore list uses `.gitignore` syntax (package `ignore`). Dropbox's name rules come from rclone and a third-party FAQ and are not verified on the live service. The configuration folder stays excluded until ticket 13. The skipped list shows in the status entry point and its click notice until ticket 14's Skipped tab; notes for ticket 15 cover name-policy changes. Still to check by hand in Obsidian: the skipped count and notice on desktop and mobile.
