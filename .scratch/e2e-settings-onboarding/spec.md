# E2E checks for onboarding, help and shared settings

Status: approved 2026-10-28

## Problem

Two features landed without a run in a real Obsidian:

- **Onboarding and help** (ticket 16, commit "feat(ui): add onboarding and
  help"). Its last criterion, "Manual check of both languages on desktop
  and a phone", is still open. The Android and pair runs only click
  "Got it" after connecting; nothing reads what the onboarding or the Help
  tab shows, in either language, on either platform.
- **Shared Remote settings and devices** (ticket 15, commit "feat(sync):
  change shared settings and devices"). Engine and jsdom tests cover it
  over the fake Dropbox. Nothing checks it in a real Obsidian's settings
  tab, or against Dropbox's own revision preconditions, which the
  collision handling relies on.

The desktop, Android and pair runs (`.scratch/check-automation/spec.md`,
`test/e2e/README.md`) get scenarios for both, reported in the run's
summary as manual checks of their own.

## New manual checks

Numbered after the 18 of the manual check list
(`.scratch/check-automation/spec.md`, "The manual checks and what covers
each"):

19. **Onboarding and help, both languages.** The onboarding shows its
    title, intro and the four practices; the Help tab shows every section
    `helpSections(strings)` gives, in order, with the "Show the four habits
    again" button; all in English and in Russian.
20. **Shared settings and devices.** A shared setting changed on one
    device reaches the other; the same setting changed on both asks which
    value to keep; a renamed device shows under its new name on the other;
    "Forget" removes a device's record.

## Scenarios

### Desktop run (no network), check 19

New file `test/e2e/desktop/onboarding-help.test.ts`. For each language,
English then Russian:

1. The "Show help" command opens the Sync window at the Help tab; the tab
   shows the headings, paragraphs and list items of
   `helpSections(strings)`, in order, in the language's strings.
2. The settings row "Open help" (named after its button) opens the same
   tab.
3. "Show the four habits again" opens the onboarding: title, intro and the
   four practices of `practices(strings)`; "Got it" closes it.

The scenario fails if the shown language is not the one set (the plugin's
strings are compared, not Obsidian's own).

### Desktop run as a phone, check 14 (extended) and 19

`describePhoneButtons` (`test/e2e/support/page.ts`) also opens the Help tab
and the onboarding from it: every button is at least 44 px high and both
windows carry `obsync-phone`. The desktop's `phone-buttons.test.ts` and the
Android run share it, as today.

### Android run, check 19

1. Check 1 (connecting) reads the onboarding before clicking "Got it":
   title and the four practices, in the phone's language.
2. A new scenario does the desktop's 1 and 3 on the phone, in English and
   Russian.

### Pair run, check 20

Added after the existing checks, as they need two connected devices
(`bail` stays: each needs the ones before it):

1. **Propagation.** The desktop adds a pattern to the ignore list in its
   settings tab and presses "Apply to all devices". After the phone's next
   sync, the phone's settings tab shows the pattern; a note the phone then
   writes under it does not reach the desktop.
2. **Collision.** With neither device syncing in between, both change the
   size ceiling to different values and apply. The device whose sync comes
   second gets the collision window; the scenario picks one value; after
   both sync again, both settings tabs show that value. Closing the window
   without an answer shows "Paused (choose shared settings)" first.
3. **Device rename.** The phone is renamed in its settings tab; after its
   next completed sync, the desktop's "Other devices" list shows the new
   name.
4. **Forget.** At the end, after the phone's Disconnect, the desktop
   forgets the phone's record; "Other devices" no longer lists it, and the
   run's Remote folder holds no record for it.

The name-policy change (refused, or accepted with a full listing after)
stays covered by the engine tests only: it needs Remote names Dropbox
cannot store, which a real account will not hold.

## Infrastructure

- **Language.** A helper sets Obsidian's language and reloads the window,
  then waits for the plugin to load again (as `becomePhone` does), on the
  desktop and the phone. `strings()` then gives the language's strings.
- **Settings tab.** A page helper opens the plugin's settings tab and
  finds a row by its name.
- No new dependency.

## Unknowns, settled by a first spike

Each is checked before any scenario is written; one that fails moves its
part to "Still checked by hand", with the reason, after the user decides.

- Setting Obsidian's language from an eval and reloading makes
  `getLanguage()` return it on the desktop and on the phone, and
  `moment.locale()` (what `strings()` reads) follows it.
- The plugin's settings tab can be opened from an eval on both.
- Two syncs on the pair can be held apart long enough to change the same
  setting on both devices before either sees the other's change.

Findings (2026-10-28):

- Language: Obsidian 1.14.4's `getLanguage()` returns
  `localStorage.getItem("language")`, else the one `navigator.language`
  names, else `en`, and sets `moment.locale()` to it when the page loads;
  the desktop bundle and the Android APK's `assets/public/app.js` read the
  same. On the desktop, run with no network, `language` set to `ru` and a
  reload gave `moment.locale()` `ru` and the plugin's Russian command
  names. The reload must be awaited: an eval right after the call still
  reads the old page. On the phone it is first run in step 5.
- Settings tab: `app.setting.open()` then `app.setting.openTabById(<plugin
  id>)` opens it on the desktop; its rows are `.setting-item-name`.
- Holding syncs apart: `changeSettings` stores the change on the device
  before it starts a sync (`src/engine/engine.ts`), so the phone, with its
  network off (`AndroidPhone.setNetwork`), keeps its change while the
  desktop writes another; the phone's sync when its network comes back
  meets the collision.

## Documentation

- `.scratch/check-automation/spec.md` lists checks 19 and 20 with what
  covers each.
- `test/e2e/README.md` needs no change unless the runs' requirements do.
- Ticket 16's last criterion is ticked once the desktop and Android runs
  pass check 19, with a comment naming the commit.

## Proposed choices (to confirm with this spec)

- The two new checks are numbered 19 and 20.
- Russian is the only second language checked: the plugin has English and
  Russian only.
- Check 20 runs in the pair run only; the Android run alone does not
  repeat it.

## Out of scope

- Fixing whatever the new scenarios find: each failure is reported and
  decided separately.
- iOS (as in `.scratch/check-automation/spec.md`).
- Running the runs in CI.
