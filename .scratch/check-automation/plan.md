# Plan: automating the manual checks

Spec: `.scratch/check-automation/spec.md` (approved 2026-10-24). Work on
`main`. Each step: tests, `code-reviewer` review with every finding put
to the user, then this file is marked. A new test of behaviour that
already works passes at once: it adds coverage, not a red step. A new
test that fails has found a defect: it is reported to the user, not fixed
here (spec, Out of scope).

- [x] 0. Spike on the spec's four unknowns: the Obsidian CLI, the
  emulator's WebView debugging, a run's vault and the plugin loading in
  it, Dropbox's authorize page without a password. Needs from the user:
  the CLI turned on in Obsidian, a Dropbox test account logged in once in
  the emulator's browser, the app key in `.env`. The results go to the
  user before step 1.
  Done so far, on the emulator: the official APK (signed by Dynalist
  Inc.) installs; Obsidian's WebView opens a
  `webview_devtools_remote_<pid>` socket, and JavaScript runs in the app
  over `adb forward` and the DevTools protocol with Node's WebSocket; a
  vault is created from the welcome screen by clicking through it (App
  storage, no Android permission); the built plugin is written into it
  through `app.vault.adapter` and loads after `app.plugins.setEnable`
  and `enablePluginAndSave` (Obsidian's internal, undocumented API).
  Open: the desktop CLI (not turned on yet) and Dropbox's authorize page
  (no test account yet). By the user's choice these two are settled
  before step 13, and steps 1 to 12 go first.
  Desktop, settled: the run uses an isolated Obsidian, so the user's own
  settings and vaults stay untouched. An install whose settings folder
  cannot be moved, as a sandboxed package that sets `XDG_CONFIG_HOME`
  itself, is not used: the run takes the official AppImage of a release,
  downloaded into the git-ignored `.e2e/` and checked against the
  release's sha256, and starts it with `XDG_CONFIG_HOME` in `.e2e/`. Before
  the start it writes `obsidian/obsidian.json` there as
  `{"vaults":{"<16 hex id>":{"path":…,"ts":…,"open":true}},"cli":true}`;
  the vault opens and the CLI is on with no user action. The AppImage's
  own `obsidian-cli`, run with the same `XDG_CONFIG_HOME`, reaches that
  instance: `vault=vault eval` answered about a second after the
  instance's `SingletonSocket` appeared.
  Dropbox, settled: with the test account signed in once in the
  emulator's browser, the plugin's authorize URL, opened there with
  `am start -a android.intent.action.VIEW`, asks for no password. It shows
  three pages: a warning that the app has few users (Continue), the
  permissions (Allow), and the code, which is also in the address as
  `authorize_success?auth_code=…`. The run taps the buttons by their text
  through `uiautomator dump` and `input tap`. An app in development status
  links only its owner's account until "Enable additional users" is
  turned on in the App Console; until then the page says the app "has
  reached its user limit".
- [x] 1. Vitest fakes: binary files in `FakeObsidianVault`; two plugins in
  one test, each with its own notices and windows. Each device of
  `test/support/plugin-devices.ts` imports its own instances of the fake
  `obsidian` module and the plugin; the helpers shared with
  `test/main.test.ts` are in `test/support/plugin-run.ts`. The pages a
  connect window opens are one list for all devices: they share the
  window. A failed device start is cleaned up, untested.
- [x] 2. Check 9: an image of non-UTF-8 bytes between two plugins; a
  binary conflict gives a Conflict copy, its notice and a Conflicts entry.
  `test/plugin/images.test.ts` passes, both directions included: images
  not syncing on the user's devices does not show over the fakes. Tests
  wait for what a sync does (the Remote's bytes, the vault's file), not
  for a quiet network; 20 parallel runs passed.
- [x] 3. Check 5: a second device connects to the same Remote; preview
  counts, then the union in both vaults.
  `test/plugin/first-sync.test.ts` passes. Two engine tests fail now and
  then in full runs under CPU load; a measured A/B showed the plugin tests
  are not the cause, so they are tracked in
  `.scratch/test-timing/issues/01-timing-sensitive-tests.md`.
- [x] 4. Checks 2, 3, 15 in the running plugin: Disconnect revokes; a
  failed connect writes its `obsync.log` line; one notice and no preview
  after Reconnect.
  `test/plugin/connection.test.ts` covers checks 2 and 3, the Reconnect
  test of `test/main.test.ts` check 15. Each new assertion fails with the
  behaviour broken on purpose. A failure written to the log twice is not
  caught: the spec asks only for its line.
- [x] 5. Check 6: `online` and `visibilitychange` start a sync.
  `test/plugin/triggers.test.ts`: each event brings the other device's
  change; `hidden` sends no request of the phone's within 300 ms and a
  quiet network, which proves its absence as far as a wait can.
  `PluginDevices.connectBoth`, `remoteBytes` and a device's
  `requestCount` are shared with `images.test.ts`.
- [x] 6. Checks 4 and 14: the Sync window, its tabs and commands, "Copy
  for a bug report", ribbon icon and status bar, `obsync-phone`.
  `test/plugin/sync-window.test.ts`. On a phone the connect, First sync
  and Sync windows are checked for `obsync-phone`; the Deletion guard,
  Restore and Edit windows go with steps 7, 9 and 11. Found: the Restore
  window (`RestoreConfigurationModal`, a `SuggestModal`) does not call
  `fitForPhone`, though `phone-modal.ts` says every modal does; decided
  at step 9.
- [x] 7. Checks 10 and 11: a folder rename through the whole plugin; the
  Deletion guard window.
  `test/plugin/folder-rename.test.ts` and `test/plugin/deletion-guard.test.ts`.
  The folder's notes hold the same text, so only the vault's and the
  Remote's renames find where they went; turning either off sends them to
  the trash, which the test catches. The fake vault tells a folder rename
  in one event; whether Obsidian also tells one per file inside is checked
  in step 13. `PluginDevice.windowsOpened` lists the windows a device
  opened.
- [x] 8. Check 12: the real limits (100 MB, `desktop.ini`, trailing
  space) and the Skipped tab.
  `test/plugin/skipped.test.ts`, at 100 MiB + 1 byte: the ceiling is
  100 MiB in the code. A lowered default is caught by
  `test/engine/connection.test.ts`, which pins it. The Sync window helpers
  are in `test/support/plugin-devices.ts`.
- [x] 9. Check 13: the restart notice for `data.json` and
  `community-plugins.json`; the Restore local window and command.
  `test/plugin/configuration.test.ts`. By the user's decision the Restore
  list (`RestoreConfigurationModal`) now calls `fitForPhone`, so it gets
  `obsync-phone`. Without buttons, it only carries the class. The test
  drives the list through the methods Obsidian calls, since the fake
  suggest window draws nothing.
- [x] 10. Check 7: fake `MarkdownView` and `Editor`; the cursor keeps its
  place.
  `test/plugin/editor.test.ts`; a test opens a note with
  `FakeWorkspace.openInEditor`. The fake editor maps the cursor through a
  change as CodeMirror 6 does (checked against `@codemirror/state`) and
  fails on positions outside the text. Typing in an open editor is not
  covered: `.scratch/check-automation/issues/01-typing-in-open-editor.md`.
- [x] 11. Check 8: the conflict action row in a CodeMirror 6 `EditorView`
  (jsdom), the Edit… dialog, Next and Previous conflict, the Reading view.
  `test/plugin/text-conflict.test.ts`, on blocks a real sync wrote. The
  fake gained Obsidian's global `createEl`/`createDiv`/`createSpan`, a
  node's `win`, `PostProcessorContext`, and editor commands in
  `runCommand`. The Reading view sections are the test's own; how
  Obsidian splits a note with markers is left to the desktop run.
- [x] 12. Check 18: a schema 3 snapshot database opens as a complete
  snapshot.
  `test/plugin/snapshot-upgrade.test.ts`. The fixture
  (`test/support/schema-3-snapshot.ts`) turns the state a real sync left
  into what the build before First sync (`acd0340^`) would have left:
  three stores at schema 3, no `conflicted` or server hash, a Connection
  without `firstSyncDone` or `reconnectNeeded`. `PluginDevices.restart`
  restarts a device on what outlives an Obsidian restart.
- [x] 13. Desktop run: config, `pnpm test:e2e:desktop`, scenarios for
  selectable error text, Live Preview and Reading view, 44 px in mobile
  emulation. Also record the `rename` events Obsidian gives for a folder
  renamed with files inside (step 7). No Dropbox login: the cursor check
  needs a change from another device, so by the user's decision it moved
  to step 15.
  `test/e2e/desktop/` with `vitest.e2e.desktop.config.mjs`; the helpers in
  `test/e2e/support/` (their unit tests run in `pnpm test`). Obsidian, the
  release's AppImage extracted under `.e2e/`, runs with no network
  (`unshare --user --net`, the CLI too) unless a scenario asks for one, so
  the run never reaches Dropbox; check 3 shows the error for Dropbox out of
  reach. Obsidian renders only while its window has focus, so every call
  brings it to the front. The summary prints checks 3, 8 and 14 (14 only
  for the windows that open without a login).
  Found: in Live Preview the block's `=======` makes the line above it a
  heading, `>>>>>>>` renders as a seven-level quote, and the line after the
  block joins that quote, so check 8 fails; Reading view is right. Obsidian
  gives a `rename` for a renamed folder and then for each folder and file
  inside it, where the fake vault gives one (step 7). Both are for the user
  to decide.
- [x] 13a. The fake vault gives a renamed folder's events as Obsidian
  does: one for the folder, then one for each folder and file inside it,
  in Obsidian's order (by the user's decision after step 13). The desktop
  scenario's folder is laid out so that the order Obsidian follows shows.
  A test of the engine or the plugin that fails on the new events has
  found a defect: it is reported, not fixed here.
  Seen in Obsidian, with `vault.rename` as the plugin calls it: the order
  the vault came to know the entries (not depth or breadth first, nor by
  name), and all nine events before the rename resolves, so the engine
  still knows its own renames. `FakeObsidianVault.rename` does the same,
  leaving out hidden entries. No engine or plugin test failed. Tickets
  from the review: 03 (hints quadratic in a folder's files), 04 (the fake
  renames onto a taken path), 05 (no test notices `isOwnRename` broken;
  the engine's `fake-vault.ts` still tells one event per folder).
- [x] 14. Android run: config, `pnpm test:e2e:android`, scenarios for
  connect and Disconnect, the clipboard, 44 px, 50 MB, the long note
  merge. Design, by the user's decision: the emulator's virtual device
  named by `OBSYNC_E2E_AVD`, started and closed by the run; the release's
  APK in `.e2e/`, checked against its sha256; app data cleared, the vault
  made through the welcome screen, the plugin written through the
  adapter; JavaScript through the WebView's DevTools over `adb forward`.
  The login taps through the authorize page in the emulator's browser and
  reads the code from its address; the run's Remote folder, `e2e-<time>`,
  is made in the connect window and deleted at the end. The token and the
  app key stay inside the WebView. Disconnect is followed by one exchange
  of the old refresh token, expected to be refused, once per run. Check 3
  runs with the emulator's network off, checked before the code is
  entered, so nothing is sent. The 50 MB file comes back through
  `requestUrl` on the phone and is compared by hash. The merge is the
  20,000-line one of `text-merge.test.ts`, bundled with esbuild, under
  1 s. Check 6 moves to step 15: its change is made on the desktop.
  The emulator, by the user's decision: the image with Google's apps
  overloaded the machine (System UI not responding, guest load near 40),
  so the run uses a light device, the image without Google's apps
  (`android-37.0;default;x86_64`, checked by its SHA-1) in
  `.e2e/android/sys-img/` and the device in `.e2e/android/avd/`, started
  with `ANDROID_AVD_HOME` and `-sysdir`, 1080×2400. A minute after boot:
  guest load 6.5, no ANR. Its only browser is the WebView shell
  (`org.chromium.webview_shell`), which opens Dropbox's pages; the test
  account is logged in there. Settled on it: the clipboard (write and
  read in the WebView), the network off and on (`cmd connectivity
  airplane-mode`), the DevTools socket.
  Seen while building it: `pm clear` leaves a vault made in "App
  storage" (on external storage), so the run deletes that folder too;
  Obsidian makes `window.app` a moment before its workspace. Obsidian's
  `requestUrl` on Android turns a whole response into one base64 Java
  string: one 50 MB download ran its process out of memory (logcat), so
  the scenario reads the file back in `Range` parts of the plugin's own
  Per-request limit, as the plugin does; the plugin's upload was not
  affected. The review's findings were all fixed, by the user's decision,
  but one: deleting the run's Remote folder right before Disconnect
  stays, as turning the plugin off meanwhile and on again starts a sync at
  once. Five green runs in all; the five repeats were stopped after three
  by the user, to spare Dropbox's login, and one run checked the review's
  fixes. A repeat stopped mid-run may have left an `e2e-<time>` folder and
  a valid login: not checked, as that needs Dropbox requests.
- [x] 15. Desktop and emulator together: First sync (check 5), images
  (check 9), the cursor in the desktop's real editor (check 7) when the
  phone's change arrives, and the phone sent to the background and back,
  and its network turned off and on, each bringing a change made on the
  desktop (check 6).
  Design, by the user's decision: a run of its own, `test/e2e/pair/`,
  `pnpm test:e2e:pair`, reporting checks 5, 6, 7 and 9; the desktop
  Obsidian online and the emulator as in step 14, both closed at the end.
  Two logins per run, one per device, and no refused request: the
  desktop's `activeWindow.open` is caught in its page, so no browser of
  the user's opens, and its authorize address is opened in the
  emulator's browser through DevTools, where the test account is logged
  in; the code goes into the desktop's connect window. The desktop
  connects first, making `e2e-<time>` with a note and a PNG; the phone,
  with a note and a PNG of its own, connects to that folder; the First
  sync window's counts are checked, then the union on both, images by
  sha256 (checks 5, 9). A note open in the desktop's editor, the cursor
  at a known offset, changed by the phone after the cursor: after
  `sync-now` the text is updated in place and the offset kept (check 7).
  The phone's polling interval set to 3600 s; a change made and synced on
  the desktop arrives within 30 s after the phone comes back from the
  background, and again after its network is turned off and on
  (check 6). At the end the run's folder is deleted and both devices
  disconnect. One run checks the step; repeats only with the user's
  leave.
  Done: the login, Disconnect and cleanup moved from the Android run into
  `test/e2e/support/dropbox-login.ts`, which both runs use. All 16 review
  findings fixed, by the user's decision; among them the folder is
  deleted through whichever device still has a login (`requestUrl` is a
  global on the desktop too, seen on an offline desktop Obsidian), the
  cleanup brings the phone to the front and online first, Disconnect is
  pressed whatever the deletion came to, uploads are watched by listing
  the run's folder (no 409 for a file not there yet), and the run stops at
  its first failure. The first pair run did not start (the emulator's
  virtual device was not named in the command); then one pair run passed
  before the review fixes and one after, and one Android run after them.
- [x] 16. Verification: typecheck, lint, all tests, build, both runs;
  then the user is asked about a commit.
  Done: the first desktop run failed only on check 8's Live Preview test,
  the heading and quote found in step 13. Fixed first, by the user's
  decisions, in `3cb34d7` (ticket
  `.scratch/conflict-live-preview/issues/01-conflict-block-in-live-preview.md`);
  check 8 also clicks a marker line and checks a quote of the note's own,
  and the desktop runs close Obsidian's prompt to trust a vault's author,
  which covered the workspace. Then typecheck, lint, all tests (110
  files) and the build passed, a full desktop run passed (4 files, 10
  tests), one Android run before the fix passed (8 tests), and after it
  the Android run of check 14's conflict row, without a login.
