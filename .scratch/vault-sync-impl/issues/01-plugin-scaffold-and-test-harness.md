# 01: Plugin scaffold and test harness

Parent spec: `.scratch/vault-sync/spec.md` ("Vault sync plugin: first release").

**What to build:** An installable Obsidian community plugin that loads on desktop, Android and iOS and shows a "Not connected" state. Underneath is the skeleton every later ticket builds on:

- the sync engine module, with its ports: Provider, Local vault, Device store, Secret store, clock and scheduler, UI port;
- in-memory FakeProvider and FakeVault for tests;
- an empty Provider contract test suite wired to run against the FakeProvider;
- an English/Russian string table selected by Obsidian's language.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [ ] The plugin builds into the three community-plugin files and loads on desktop, Android and iOS without errors.
- [ ] The build and lint follow the project's `obsidian` skill rules: network through `requestUrl`, no Node or Electron APIs on mobile paths.
- [ ] Vitest runs in the project's task runner, and a first engine test passes against FakeProvider and FakeVault.
- [ ] FakeProvider supports these test controls:
  - Capability toggles: conditional write, change feed, file move, folder move;
  - configurable name rules and maximum file size;
  - fault injection: `throttled`, `transient`, `cursorLost`, `preconditionFailed`, and a crash between steps.
- [ ] Several engine instances can share one FakeProvider Remote, standing in for several devices.
- [ ] Every UI string comes from the EN/RU table, and switching Obsidian's language switches the plugin's language.
- [ ] A "Not connected" state is visible: a status bar item on desktop, a ribbon icon on mobile.

## Comments

- 2026-10-19: Implemented in commit `3149750` (feat(plugin): add scaffold and test harness) on `main`; plan: `.scratch/vault-sync-impl/plans/01-plugin-scaffold.md`. Ticket closed.
