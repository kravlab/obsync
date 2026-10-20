# 05: Sync triggers and interruption safety

Parent spec: `.scratch/vault-sync/spec.md`, "Sync triggers and lifecycle" and "Remote layout and change detection" (change feed).

**What to build:** Sync happens without the user pressing anything, and it is safe to cut off at any moment. Triggers:

- opening the vault;
- a short pause after edits;
- polling while open;
- returning to the app;
- the network coming back.

A sync interrupted by backgrounding, a lost network or closing Obsidian finishes its work next time. Being offline shows as a calm state.

**Blocked by:** 03 (Two-way sync of new and changed files).

**Status:** resolved

- [ ] The triggers are wired: vault open after `onLayoutReady`; the post-edit pause; polling; `visibilitychange` → `visible`; `online`. `hidden` is not relied on. The pause and polling intervals are settings.
- [ ] At most one sync runs per device; triggers that fire during a sync collapse into one follow-up.
- [ ] Local changes are found by a full walk on vault open and on every poll: mtime and size first, hashing only what changed. Edits made while Obsidian was closed are synced.
- [ ] The Dropbox `changes` Capability uses `list_folder/continue`. A cursor reset maps to `cursorLost`, and the engine falls back to a full listing. A "full reconcile" command exists.
- [ ] Order of work: local uploads first, small text before large attachments, then downloads.
- [ ] There is no persisted queue. Engine tests that crash between any two steps show the next sync completing the work with no loss.
- [ ] Offline gives backoff retries, an "Offline" state, and no repeated notices.

## Comments

- 2026-10-20: Implemented in commit `9ef23bd` (feat(sync): sync on its own and survive being cut off) on `feat/sync-triggers`; plan: `.scratch/vault-sync-impl/plans/05-sync-triggers.md`. Ticket closed. Still to check by hand in Obsidian on desktop, Android and iOS: the `visibilitychange` and `online` triggers, the settings rows, and the snapshot database upgrade with the change-feed store.
