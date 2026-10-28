# Obsync

Sync a vault across devices through a cloud storage service.

## Testing

- `pnpm test` runs the unit tests and the tests of the whole plugin on a
  fake vault and a fake Dropbox: no network, no Obsidian. The pre-commit
  hook runs it.
- `pnpm test:e2e:desktop`, `pnpm test:e2e:android` and
  `pnpm test:e2e:pair` drive a real Obsidian on the desktop and on an
  Android emulator. They run on Linux only and need a setup done once:
  see [test/e2e/README.md](test/e2e/README.md).
