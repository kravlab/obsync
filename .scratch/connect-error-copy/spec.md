# Copying a connect error, and a log file of them

Status: approved 2026-10-21; implemented in b492b6c, widened to every
connect failure by `.scratch/review-fixes/spec.md` in dbfd750

## Problem

When connecting fails, the connect window shows the message and a
"Details: …" line, but on a phone the text cannot be copied: it cannot be
selected, and there is no button. The failure reaches the Activity log,
but getting it off the phone needs the Sync window and its clipboard
button. Diagnosing a failure on Android took a screenshot.

## Behaviour

1. **Selectable.** The connect window's message and its "Details: …" line
   can be selected and copied with the platform's own selection (long
   press on Android and iOS, mouse on desktop).
2. **Copy button.** While a provider failure is shown, a "Copy error"
   button sits under the "Details: …" line. It copies the message and the
   details line, as shown, one per line. Then a notice says "The error is
   copied."; if the clipboard refuses, the notice says "The error could
   not be copied. Select it and copy it by hand." The button is at least
   44 px tall on phones, as every button of the plugin's modals. Messages
   that are not provider failures (a refused code, a taken name) get no
   button.
3. **Log file.** Every failure while connecting (the ones the Activity log
   keeps as "Connecting failed") is also appended to
   `obsync.log` in the plugin's own folder
   (`<config folder>/plugins/obsync/`), one line per failure, in English,
   worded as in "Copy for a bug report":
   `2026-10-21 16:37 Connecting failed. Dropbox refused a request. (HTTP 400: …)`.
   - The file keeps the newest 100 lines, like the Activity log.
   - The plugin's own folder never syncs, so the file stays on the device.
   - A file that cannot be written is reported in the console and changes
     nothing else: connecting goes on as without it.
4. **Text.** "Copy error", the two notices: English and Russian.

## Seams under test

- The log file's content: a failure becomes the English line above; the
  newest 100 lines are kept, oldest dropped.
- The log file store over a fake vault adapter: appends to an existing
  file, creates a missing one, a write failure does not throw on.
- The text copied by the button: the message and the details line, or the
  message alone without details.
- New strings in EN and RU.

Not unit-tested (no DOM, no clipboard in the tests), checked by hand on
Android and desktop: selecting the text, the button and its notices, the
file appearing in the plugin's folder.

## Out of scope

- Writing sync failures to the file; they stay in the Activity log.
- Changing how "Copy for a bug report" copies.
