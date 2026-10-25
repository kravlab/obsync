# Plan: fixes from the full code review

Spec: `.scratch/review-fixes/spec.md` (approved 2026-10-24). Work on `main`.
Each step: failing test, fix, `code-reviewer` review with every finding
put to the user, then this file is marked.

- [x] 0. Test infrastructure: `jsdom` and `fake-indexeddb` as dev
  dependencies, a fake `obsidian` module in `test/fakes/`, jsdom for the
  window and plugin tests; engine tests stay in Node (spec 20). The fake
  grows in the step whose test needs more of Obsidian: `Plugin` and the
  shell's API in steps 5 and 14, modal `hide`/`toggle` with the tests of
  those windows.
- [x] 1. Every connect window failure, unexpected ones included, gets
  the button, the `obsync.log` line and the Activity entry; texts EN/RU
  (spec 1, 19, 20).
- [x] 2. "Connect anyway" is one button and goes with its message (spec 2).
- [x] 3. A refused revoke on Disconnect goes to Activity and
  `obsync.log` (spec 3).
- [x] 4. Connection epoch: Disconnect voids holds and rename hints; a
  sync running across it writes no device state (spec 4, 5).
- [x] 5. A sync starts right after a new Connection (spec 6).
- [x] 6. Conflict copy names fit the provider's longest name (spec 7).
- [x] 7. A last line break alone is no conflict (spec 8).
- [x] 8. The stored change-feed state keeps server hashes (spec 9).
- [x] 9. First sync preview: the JSON outcome, the file line through the
  strings (spec 10, 18).
- [x] 10. A short single download fails (spec 11).
- [x] 11. The Remote is matched by Dropbox's `path_lower` (spec 12).
- [x] 12. No `obsync.log` line is lost (spec 13). The test that a failed
  write leaves the queue working passed before too: it guards against a
  later break, not a red step.
- [x] 13. Snapshot database: a failed old-database delete is reported; a
  blocked open leaves no connection (spec 14, 15). Also, from the step 5
  review: a jsdom test of the Base round trip over fake-indexeddb, since
  `instanceof ArrayBuffer` in device-store.ts may not recognise a buffer
  of another realm; fixed there if it shows.
- [x] 14. A plugin unloaded before the layout starts nothing; Activity
  lines selectable on iOS (spec 16, 17).
- [x] 15. Verification: format, typecheck, lint, all tests, build. The
  project has no formatter configured; typecheck, lint, the 960 tests and
  the build pass.
