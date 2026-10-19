# Plan: 01 Plugin scaffold and test harness

Ticket: `.scratch/vault-sync-impl/issues/01-plugin-scaffold-and-test-harness.md`
Branch: `feat/plugin-scaffold`
Status: approved 2026-10-19

## Decisions

- **Manifest:** id `obsync`, name `Obsync`, author `kravlad`; `minAppVersion` 1.11.4, the first version with `SecretStorage`.
- **Plugin name before release:** `Obsync` starts with "Obsi", which community submission rejects (`obsidian` skill rule 3) and the linter does not catch. The name changes before the plugin is submitted; the id `obsync` stays. Deferred 2026-10-19 at the user's request.
- **Tools (mise.toml):** node 24.21.0, pnpm 12.13.0; mise tasks `build`, `typecheck`, `lint`, `test`, `check`, plus `setup-dev` and `setup-agent` for the devcontainers (added 2026-10-19 at the user's request).
- **devDependencies (exact):** `obsidian` 1.14.4, `typescript` 6.0.3, `esbuild` 0.28.2, `vitest` 5.0.4, `eslint` 9.39.5, `@eslint/js` 9.39.5, `@eslint/json` 0.14.0, `typescript-eslint` 8.71.2, `eslint-plugin-obsidianmd` 0.4.2.
- **Strings:** own typed EN/RU modules (`en.ts`, `ru.ts`), language from `getLanguage()`, unknown language falls back to English.
- **Layers:** `src/engine/` (core, never imports `obsidian`), `src/ui/` (plugin shell and strings), `test/fakes/` (FakeRemote, FakeProvider, FakeVault; not bundled).
- **Ports:** Provider and Local vault per the spec's contract; Device store, Secret store, Clock, Scheduler and UI port in the minimal form the spec names; provider errors carry the spec's ten categories.
- **FakeProvider:** several FakeProviders share one FakeRemote, one per device. Capability toggles, name rules, maximum size, per-device faults (`throttled`, `transient`, `cursorLost`, `preconditionFailed` through a concurrent writer) and a crash before or after the Nth operation.
- **Contract suite:** not empty; it covers what FakeProvider implements.
- **First engine test:** a device with no Connection reports "Not connected".
- **Shell:** status bar item on desktop, ribbon icon on mobile; a click shows a notice with the state until the Sync window exists (ticket 14). The engine is wired into the shell in ticket 02.

## Test seams

1. Sync engine through its ports.
2. Provider contract suite, against FakeProvider only for now.
3. FakeProvider and FakeVault controls, through their own ports.
4. String table: language selection and fallback; key parity is checked by the compiler.

UI and loading on devices are checked by hand.

## Steps

Steps 1–5 were each reviewed on completion; from step 6 on there is one review, in step 10 (changed 2026-10-19 at the user's request).

- [x] 1. Toolchain: `.gitignore`, `package.json`, `pnpm install`, tsconfig, ESLint, esbuild, Vitest, mise tasks.
- [x] 2. Shell: `manifest.json`, `src/main.ts`, `styles.css`; the build emits the three files.
- [x] 3. EN/RU string table (seam 4).
- [x] 4. Ports and provider error categories (typecheck).
- [x] 5. FakeRemote and FakeProvider required operations, and the contract suite (seam 2).
- [x] 6. FakeProvider toggles, name rules, size, faults and crashes (seam 3).
- [x] 7. FakeVault (seam 3).
- [x] 8. Engine factory and the first engine test (seam 1).
- [x] 9. Status bar item and ribbon icon showing "Not connected" from the string table.
- [x] 10. Full test run, typecheck, lint, build, code review, report.
