# Seamsync

Sync a vault across devices through a cloud storage service.

Seamsync is an Obsidian plugin that keeps one person's vault the same on all
of their devices, desktop and mobile. This release syncs through Dropbox.

## Features

- **Dropbox, App Folder access.** The plugin reaches only
  `Apps/<app folder name>` in Dropbox. Each synced vault (a Remote) is a
  subfolder there, chosen or created when you connect. It asks for the
  `files.metadata.read`, `files.content.read`, `files.content.write` and
  `account_info.read` scopes and nothing else.
- **A plain mirror.** The Remote holds the vault's files at the same paths,
  readable in Dropbox itself. The plugin's own data lives in one `.seamsync`
  folder there; do not modify it.
- **Automatic sync.** Seamsync syncs when the vault opens, after an edit once
  the post-edit pause has passed, on a polling interval while Obsidian is
  open, when the app becomes visible and when the network comes back.
  Offline, it retries quietly with backoff.
- **Text merge.** Concurrent edits to text files are merged line by line
  against the last synced version. Lines both devices changed become
  conflict blocks (`<<<<<<<`, `=======`, `>>>>>>>`) that you resolve in the
  editor: keep one side, keep both, or edit.
- **Conflict copies.** A file that cannot be merged, such as an image or a
  PDF, keeps the other device's version at its path, and this device's
  version is kept next to it as
  `Name (conflict <device name> YYYY-MM-DD HHmm).ext`.
- **Deletion guard.** A sync that would delete more than a set number or
  share of files on either side pauses and asks first. The first sync
  never deletes anything and shows a preview before it starts.
- **Configuration folder sync, opt-in.** Settings and hotkeys, themes and
  snippets, and plugins each sync only if you turn them on. The workspace
  layout never syncs. Other plugins' settings may hold secrets, which are
  then copied to Dropbox.
- **Shared settings.** An ignore list in `.gitignore` syntax, the
  extensions treated as text, the size limit and how to handle names
  Dropbox cannot store apply to every device.
- **Sync window.** Conflicts, skipped files, an activity log with a
  "Copy for a bug report" action, and help.
- **Languages.** English and Russian, chosen from Obsidian's language.

Dot-files and dot-folders such as `.git` and `.trash` never sync, except
the configuration folder categories you turn on.

## Installation

Seamsync is not in the Obsidian community plugin list. To install it, build
it from source (see [Development](#development)) and copy
`dist/main.js`, `dist/manifest.json` and `dist/styles.css` into
`<vault>/.obsidian/plugins/seamsync/`, then enable **Seamsync** in
**Settings → Community plugins**.

It needs Obsidian 1.11.4 or later.

## Usage

1. Open **Settings → Seamsync** and select **Connect**.
2. Select **Open Dropbox**, allow access, copy the code Dropbox shows and
   paste it into the **Code** field.
3. Choose an existing folder or create a new one, and name this device.
4. Read **Before you sync**, review the first sync preview and start it.

Repeat on every other device, choosing the same folder.

The refresh token is kept in Obsidian's secret storage on the device. It is
not written to the vault, to the plugin's `data.json` or to Dropbox.
**Disconnect** revokes it.

### Commands

| Command                                                         | What it does                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Sync now                                                        | Syncs right away. Also lifts a deletion guard pause.                           |
| Full reconcile                                                  | Syncs by listing the whole Remote instead of reading the change feed.          |
| Open sync window                                                | Opens the sync window.                                                         |
| Show conflicts / Show skipped files / Show activity / Show help | Opens the sync window on that tab.                                             |
| Next conflict / Previous conflict                               | Moves between conflict blocks in the open note.                                |
| Restore local configuration                                     | Restores this device's version of a configuration file replaced in a conflict. |
| Reconnect to Dropbox                                            | Offered only when Dropbox asks for a new login.                                |

On desktop the status bar shows the sync state; on mobile a ribbon icon
does. Selecting it opens the sync window.

### Settings

This device only:

| Setting                                                             | Default | Range       |
| ------------------------------------------------------------------- | ------- | ----------- |
| Post-edit pause (seconds)                                           | 2       | 1 to 60     |
| Polling interval (seconds)                                          | 60      | 10 to 3600  |
| Per-request limit (MiB)                                             | 16      | 1 to 19     |
| Deletion guard: files                                               | 100     | 1 to 100000 |
| Deletion guard: percent                                             | 50      | 1 to 100    |
| Sync settings and hotkeys / Sync themes and snippets / Sync plugins | off     |             |

All devices, stored on the Remote and saved with **Apply to all devices**:

| Setting                    | Default            |
| -------------------------- | ------------------ |
| Names Dropbox cannot store | Skip and list them |
| Text files                 | `md`, `txt`        |
| Ignore list                | empty              |
| Size limit (MiB)           | 100                |

## How it works

The design is recorded in [docs/adr/](docs/adr/) and the terms in
[GLOSSARY.md](GLOSSARY.md):

- [ADR 0001](docs/adr/0001-sync-through-provider-abstraction.md): the sync
  engine talks to storage only through a provider contract; Dropbox is the
  one provider built.
- [ADR 0002](docs/adr/0002-remote-mirror-with-listing-based-change-detection.md):
  the Remote is a plain mirror, and changes are found by comparing its
  listing or change feed with each device's own snapshot.
- [ADR 0003](docs/adr/0003-device-journals-instead-of-locks.md): device
  journals for providers without conditional writes. This is the design
  only; this release does not build it, and Dropbox uses conditional writes.
- [ADR 0004](docs/adr/0004-dropbox-app-folder-access.md): Dropbox App
  Folder access instead of Full Dropbox.

## Development

Tools: Node.js, pnpm, lefthook, gitleaks, typos, shellcheck and shfmt,
at the versions pinned in [mise.toml](mise.toml). With [mise](https://mise.jdx.dev/):

```bash
mise install
```

```bash
pnpm install --frozen-lockfile
```

```bash
lefthook install
```

`mise run setup-dev` does all three.

A dev container is provided in [.devcontainer/](.devcontainer/).

The build bundles a Dropbox app key, which is never committed. Set
`SEAMSYNC_DROPBOX_APP_KEY` in the environment or in a git-ignored `.env`
file; the build stops with an error without it. The app must have App
Folder access.

| Command              | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `pnpm build`         | Type-checks, then bundles the plugin into `dist/`, minified. |
| `pnpm dev`           | Rebuilds `dist/` on every change, with inline source maps.   |
| `pnpm typecheck`     | Type-checks.                                                 |
| `pnpm lint`          | Lints with `eslint-plugin-obsidianmd`; any warning fails.    |
| `pnpm lint:md`       | Lints the tracked Markdown files.                            |
| `pnpm lint:sh`       | Lints the shell scripts and checks their format.             |
| `pnpm spell`         | Spell-checks with typos.                                     |
| `pnpm knip`          | Finds unused files, exports and dependencies.                |
| `pnpm format`        | Formats the tracked files with Prettier.                     |
| `pnpm format:check`  | Checks the format, changing nothing.                         |
| `pnpm test`          | Runs the unit and plugin tests.                              |
| `pnpm test:coverage` | Runs the tests; fails below the coverage thresholds.         |

`mise run check` runs every check that changes nothing.

The git hooks (lefthook.yml) check:

- pre-commit: formats the staged files (Prettier, shfmt), then scans
  them for secrets (gitleaks), spelling, Markdown and shell lint, and
  runs the type check, lint and tests;
- commit-msg: Conventional Commits, subject up to 50 characters, body
  lines up to 72, and no Claude Code session link;
- pre-push: the build, the tests with coverage, knip, `pnpm audit`, and
  a secret scan of the commits being pushed.

## Testing

- `pnpm test` runs the unit tests and the tests of the whole plugin on a
  fake vault and a fake Dropbox: no network, no Obsidian. The pre-commit
  hook runs it.
- `pnpm test:e2e:desktop`, `pnpm test:e2e:android` and
  `pnpm test:e2e:pair` drive a real Obsidian on the desktop and on an
  Android emulator. They run on Linux only and need a setup done once:
  see [test/e2e/README.md](test/e2e/README.md).

## License

[MIT](LICENSE)
