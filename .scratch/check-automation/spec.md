# Automating the manual checks

Status: approved 2026-10-24; implemented in da6a4b3 and 137d094, except
check 14 for the First sync and Deletion guard windows (#6)

## Problem

Every change is checked by hand on a desktop and on phones, through a
20-point list (below). Most of those points have engine tests, but the
plugin as Obsidian runs it is barely tested: two end-to-end tests in
`test/main.test.ts`, no test of `ObsidianLocalVault`, of the Sync window,
the status indicator, the conflict commands, the reading view, or any
modal but the connect window. Images not syncing (manual check 9) went
unseen because no test moves a binary file through the plugin between two
devices.

Everything that can be checked by a program is checked by one, at three
levels:

- **Vitest** over the existing fakes (Node, jsdom, fake-indexeddb): part
  of `pnpm test`, so of the pre-commit hook.
- **Desktop Obsidian**, driven through the Obsidian CLI: what only a real
  Obsidian renders (styles, Live Preview, Reading view).
- **Android emulator**, Obsidian installed from its official APK, driven
  through `adb` and the WebView's DevTools: what only a phone's runtime
  does (`requestUrl`, going to the background, losing the network, memory).

The desktop and Android runs talk to a real Dropbox test account, since a
real Obsidian's `requestUrl` reaches the real service. They are run by a
command of their own, not by `pnpm test` or the hook.

## The manual checks and what covers each

Numbers are those of the manual check list. "Vitest", "Desktop" and
"Android" are the three levels above.

1. **Connect, Content-Type.** Already Vitest (`test/providers/dropbox-connect-step.test.ts`).
   Android: connecting through the real `requestUrl` succeeds.
2. **Disconnect.** Vitest: Disconnect in the settings tab of the running
   plugin revokes the login on the fake service. Android: Disconnect ends
   without an error and the token no longer works.
3. **Connect window error.** Vitest: a failed connect in the running
   plugin appends its line to `<configDir>/plugins/obsync/obsync.log`.
   Desktop: the message and its detail line are selectable
   (`user-select: text` as computed). Android: "Copy error" puts the text
   on the clipboard.
4. **Activity.** Vitest: the Sync window's Activity tab shows the failure
   with its detail; "Copy for a bug report" copies the report and shows
   its notice.
5. **First sync.** Vitest: two plugins, each with its own vault, on one
   fake Dropbox; the second connects to the first's Remote, the preview
   shows its counts, and after it both vaults hold the union.
   Desktop + Android: the same between the two real devices.
6. **Triggers.** Vitest: `online` and the document becoming visible each
   start a sync. Android: the app sent to the background and back, and the
   network turned off and on, each bring a change made on the desktop.
7. **Cursor.** Vitest: a note open in an editor, changed on the other
   device, is updated in place and the cursor keeps its offset (fake
   `MarkdownView` and `Editor`). Desktop: the same in the real editor.
8. **Text conflict.** Vitest: the action row's buttons resolve the block,
   Edit… combines both sides, Next conflict and Previous conflict move the
   cursor, the Reading view panel shows both sides. Desktop: in Live
   Preview the marker lines render as plain text, not as a heading or a
   quote; in Reading view no stale panel and no lost text after editing
   the block's lower part and after deleting only the `<<<<<<<` line.
9. **Binary conflict and images.** Vitest: an image of non-UTF-8 bytes
   added on one device arrives intact on the other through the whole
   plugin (vault adapter, Dropbox provider, fake Dropbox); the same image
   changed on both gives a Conflict copy, its notice and an entry in the
   Conflicts tab. Desktop + Android: an image added on each device
   arrives on the other.
10. **Folder rename.** Vitest: through the whole plugin, the other device
    renames the folder; nothing of it goes to the trash.
11. **Deletion.** Vitest: deleting many files opens the Deletion guard
    window; its buttons go on or hold.
12. **Skipped.** Vitest: the real limits, with no test ceiling: a file
    over 100 MB, `desktop.ini`, a name ending in a space each show in the
    Skipped tab of the running plugin.
13. **Configuration.** Vitest: a changed `data.json` and
    `community-plugins.json` arriving give the restart notice; "Restore
    local" and the command "Restore local configuration" bring the local
    version back through their window.
14. **Sync window.** Vitest: the ribbon icon and status bar follow the
    state; the commands Open sync window, Show conflicts, Show skipped
    files and Show activity open their tab; each tab shows its list; on a
    phone (`Platform.isPhone`) every modal has the `obsync-phone` class.
    Desktop with mobile emulation and Android: every modal button is at
    least 44 px high, among them the buttons of the Help tab and of the
    onboarding it opens.
15. **Reconnect.** Vitest: in the existing end-to-end test, exactly one
    "Reconnect needed" notice and no First sync preview after the login.
16. **Large file.** Android: a 50 MB attachment goes up and comes back
    intact, Obsidian still running.
17. **Long note merge.** Already Vitest (`test/engine/text-merge.test.ts`,
    5,000 and 20,000 lines under 1 s). Android: the same merge within a
    time limit on the emulator.
18. **Snapshot database upgrade.** Vitest: a schema 3 database, as the
    build before First sync wrote it, opens as a complete snapshot, so no
    First sync preview.
19. **Onboarding and help.** The help and the onboarding show the
    strings of the language Obsidian is set to, English and Russian.
    Desktop (`test/e2e/desktop/onboarding-help.test.ts`): the "Show help"
    command and the settings row "Open help" open the Sync window at the
    Help tab with every section in order; "Show the four habits again"
    opens the onboarding with its title, intro and four practices, and
    "Got it" closes it. Android: the same except the settings row; check 1
    also reads the onboarding a new Connection shows. Desktop with mobile
    emulation and Android: every button of the Help tab and the onboarding
    is at least 44 px high (part of check 14).
20. **Shared settings and devices.** Pair run
    (`test/e2e/pair/pair.test.ts`): a pattern the desktop adds to the
    ignore list and applies to all devices reaches the phone, and a note
    the phone writes under it does not reach the desktop; the size limit
    changed on both while the phone is offline opens the collision window
    on the phone, closing it shows "Paused (choose shared settings)", and
    the value picked shows on both; the phone renamed shows under its new
    name in the desktop's "Other devices"; after the phone's Disconnect
    the desktop forgets it, and neither "Other devices" nor the run's
    Remote folder holds it. The name-policy change is covered by Vitest
    engine tests only (it needs Remote names Dropbox cannot store).

## Still checked by hand

- iOS: inspecting Obsidian there needs macOS (Obsidian's developer docs).
- Revoking the app on dropbox.com (check 15): only the account owner's
  web session can.
- The trash honouring Obsidian's "Deleted files" setting (check 11).
- How Obsidian itself reacts to configuration changing under it (check 13).
- A real phone's memory for 50 MB (check 16): the emulator's differs.
- The Help settings row on a phone (check 19): the Android run opens
  help from the command only.

## Test infrastructure

### Vitest

- `FakeObsidianVault` seeds binary files.
- Two plugins in one test, each with its own `FakeApp`, on one fake
  Dropbox; what each shows (notices, its windows) is told apart per plugin.
- A fake `MarkdownView` with an `Editor` (value, cursor, ranges) that the
  workspace returns for an open note.
- A fake Markdown post-processor context for the Reading view.
- CodeMirror 6 `EditorView` in jsdom for the conflict action row.
- A schema 3 snapshot database fixture over fake-indexeddb.

### Desktop and Android runs

- A command of their own each, run on demand, with long timeouts.
- Each run uses a Remote folder of its own on the test account, named with
  the run's time, and deletes it at the end.
- Secrets come from the environment or the git-ignored `.env` only: the
  app key (`OBSYNC_DROPBOX_APP_KEY`, as today) and what logs into the test
  account. Nothing of them is written to the repository or to a log.
- The emulator's virtual device is named by the environment, not in the
  repository.
- What a run finds is printed as one line per manual check: passed,
  failed with the reason, or not run.

## Proposed choices (to confirm with this spec)

- Desktop and Android scenarios are written as Vitest tests under
  `test/e2e/desktop/` and `test/e2e/android/`, each with its own config,
  run by `pnpm test:e2e:desktop` and `pnpm test:e2e:android`; excluded
  from `pnpm test`.
- Desktop: the Obsidian CLI (`eval`, `dev:dom`, `dev:css`, `dev:mobile`,
  `plugin:reload`) on a test vault created by the run in a temporary
  directory. The CLI must be turned on once in Obsidian's settings
  (Settings → General → Command line interface).
- Android: `adb` for installing the APK and the plugin, background and
  foreground, network and files; the WebView's DevTools protocol, reached
  through `adb forward`, for JavaScript in the app. Node's own WebSocket,
  no new dependency.
- Login on the devices: the test account's Dropbox login is done in the
  connect window as a user does, the code read from the authorize page;
  when Dropbox asks for the password, the run stops and says so.

## Unknowns, settled by a first spike

Each is checked before any scenario is written; one that fails moves its
checks to "Still checked by hand", with the reason, after the user decides.

- Obsidian's WebView on the emulator is listed for remote debugging.
- Obsidian on the emulator can open a vault the run created and load the
  plugin copied into it with `adb`.
- The Obsidian CLI works with the desktop Obsidian installed here and can
  open a vault the run created.
- Dropbox's authorize page on the emulator can be completed without a
  password once the test account's browser session exists.

## Out of scope

- Fixing whatever the new tests find: each failure is reported and decided
  separately.
- Running the desktop and Android runs in CI.
