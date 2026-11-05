# Fixes from the full code review

Status: approved 2026-10-24; implemented in dbfd750

## Problem

The manual check on desktop and Android found that a failed connect left
no copy button, no line in `obsync.log` and no Activity entry, and that
connecting a desktop showed no First sync preview. A read of every line
of `src/` then found these causes and further defects. Images not
syncing (manual check 9) is not among them: no cause was found in the
code, and it needs the Sync window of the device that missed the image.

## Behaviour

### Connect window

1. **Every failure is an error.** Each of these is shown with the
   "Copy error" button, appended to `obsync.log` and recorded in the
   Activity log as "Connecting failed. <why>.", like a provider failure
   today:
   - Dropbox refused the code. Dropbox's answer is kept as its detail
     ("Details: …" in the window, in parentheses in the log line).
   - The device is connected to a different Dropbox account.
   - A folder with the chosen name exists; the name contains `/`; the
     folder cannot be synced by this provider.
   - Another device is doing its First sync in the chosen folder; the
     device's name is the detail.
   - A provider failure, as today.
   - An unexpected failure (any error that is not a provider failure).
     Today it is dropped and the window shows nothing. It is shown as
     "Connecting failed unexpectedly." with its `Name: message` as the
     detail, is logged to the console, and is a bug in the Activity log.
   The window's own texts stay as they are; only the button, the log
   line and the Activity entry are added. The log and Activity lines are
   in English in the file, in the user's language in the Activity tab,
   as today.
2. **"Connect anyway" belongs to its message.** The button shown with
   "another device is doing its First sync" is removed when another
   message replaces it, and choosing a folder again shows one button,
   not a second one.

### Disconnect

3. **A refused revoke is recorded.** When Disconnect could not get
   Dropbox to revoke the login, the notice stays, and the failure is
   also recorded in the Activity log and appended to `obsync.log`:
   "Disconnecting: the login could not be revoked. <why>. (<detail>)".
4. **Disconnect ends what belonged to the Connection.** A First sync
   preview or Deletion guard prompt closed before, and the rename hints
   collected, no longer hold after Disconnect: the next Connection syncs
   and asks afresh.
5. **A sync running during Disconnect stops writing this device's
   state.** After Disconnect it writes nothing more to the Sync
   snapshot, the Bases, the change-feed state or the First sync mark,
   and ends without changing the status. Vault and Remote writes it made
   before stay. So the next connect always starts with a First sync and
   its preview.

### Connecting

6. **A new Connection syncs at once.** Right after the connect window
   reports "connected", a sync starts, as after "reconnected" today, so
   the First sync preview opens without waiting for the poll.

### Sync

7. **Conflict copy names fit the provider.** A copy's name is cut to the
   room the provider's name rules leave: its longest name (255
   characters on Dropbox) and, where it has one, its longest path less
   the folder. The original name's stem is shortened first, down to one
   character, then the device name, down to one character, and last the
   extension, from its end, with its dot once nothing is left of it; the
   date stays whole. Characters are cut as the user sees them. Today a
   long name makes the copy unstorable, the sync fails, and each later
   sync leaves another copy in the vault.
   - When the Remote cannot hold even the shortest copy name (no room
     left, or a name its name policy refuses), no copy is made: each side
     keeps its version, the file is shown as skipped ("Dropbox cannot
     store a file name"), and each later sync finds the conflict again.
     A rename that would need such a copy waits instead.
8. **A last line break alone is no conflict.** When the two versions of
   a text file differ only in whether the last line ends with a line
   break, they merge without a Conflict block, ending with the line
   break. An empty file and one holding only a line break count as such.
   Against a Base, a side that only changed the line break while the
   other added lines still gets a Conflict block: the versions differ in
   more than the line break.
9. **The stored change-feed state keeps server hashes.** A file created
   on both sides is then still recognised by its server hash on a later
   sync, instead of being downloaded: today every sync after the one that
   saved the state reads it back without them.
10. **The First sync preview tells JSON correctly.** A JSON file both
    sides hold differently is shown as "merged, or a conflict copy if
    the versions cannot be merged", which is what the sync does; today
    the preview says "conflict copy" only.

### Dropbox

11. **A short download is refused.** A download in one request whose
    length differs from the file's size fails as `permanent`, as a short
    part of a ranged download does today, instead of being written to
    the vault.
12. **The Remote is matched by Dropbox's own lower-case path.** The
    Remote's folder is matched against `path_lower` as Dropbox gives it
    for that folder, not as JavaScript lower-cases its name, so a folder
    named with characters JavaScript folds differently still lists.

### Plugin shell and stores

13. **No `obsync.log` line is lost.** Lines appended close together are
    all kept, in order.
14. **Deleting an old snapshot database that fails is reported** in the
    console as an error, not left as an unhandled rejection.
15. **A database open that was blocked leaves no open connection**: if
    it succeeds after it was given up, it is closed at once.
16. **A plugin unloaded before Obsidian's layout is ready starts
    nothing**: no sync engine, no listeners.

### Text and styles

17. Activity lines can be selected on iOS too (`-webkit-user-select`).
18. A differing file in the First sync preview is worded through the
    strings ("{path}: {outcome}"), EN and RU.
19. New texts in English and Russian: the reasons of item 1, the
    unexpected-failure message, the refused revoke, the JSON outcome.

### Tests

20. **The plugin's windows and its IndexedDB store are tested.** Today
    no test can build a window (no DOM, no `obsidian` module in the
    tests) or open the snapshot database (no IndexedDB), which is how
    the defects of items 1, 2, 6 and 13 to 16 went unseen. Tests of
    `src/ui/` windows and of `src/main.ts` run in `jsdom`, with a fake of
    the `obsidian` module (`Modal`, `Setting`, `Notice`, `Plugin`, and
    the `createEl`/`empty`/`setText` element helpers Obsidian adds);
    tests of `ObsidianDeviceStore` run over `fake-indexeddb`. Both are
    dev dependencies only. The engine and provider tests stay in Node.

## Design notes

- Items 4 and 5 share one fact: the plugin process keeps a Connection
  epoch that Disconnect advances. Each sync takes the epoch at its
  start; its writes to this device's state are refused once the epoch
  has moved on, which ends that sync; a hold is kept with its epoch and
  is void under another. Both services get the epoch through a port.
- The failures of item 1 are reported from the connection service, where
  each outcome is decided, so the window, the Activity log and the file
  all see the same failure.
- Item 12 reads the folder's metadata once per opened provider.
- Item 7 takes the provider's longest name from its name rules.

## Seams under test

- Connection service: each failure of item 1, and a refused revoke
  (item 3), reach the reporting port with their reason and detail.
- The log file text and the Activity text of every new reason, EN and RU.
- The activity store reads the new events back.
- The copied text of each connect window message with its detail.
- Engine: a hold and rename hints do not survive Disconnect; a sync
  running across Disconnect writes nothing to the device store after it.
- The Conflict copy path for long names, stem and device name.
- Text merge of versions differing only in the last line break, with and
  without a Base.
- The stored change-feed state round trip with a server hash.
- The First sync preview outcome of a JSON file.
- Dropbox client over the fake service: a short single download fails;
  a Remote whose `path_lower` differs from JavaScript's lower case lists.
- The log file store: two appends started together keep both lines.

- Connect window (jsdom, fake `obsidian`): every message of item 1 shows
  the "Copy error" button and its detail line, and the button copies the
  message and the detail; an unexpected failure is shown, not dropped;
  "Connect anyway" is one button and goes away with its message.
- Plugin (jsdom, fake `obsidian`): a sync starts after "connected" and
  after "reconnected"; a plugin unloaded before the layout is ready
  starts no engine and registers no listener.
- `ObsidianDeviceStore` over `fake-indexeddb`: a failed delete of an old
  database is reported in the console; an open that was blocked and
  succeeds later leaves no open connection; Disconnect's `clear` and the
  snapshot round trip.

Checked by hand only: item 17 (a style, which jsdom does not render).

## Out of scope

- Images not syncing (manual check 9): no cause in the code yet.
- Writing sync failures to `obsync.log`.
