# 16: Onboarding and help

Parent spec: `.scratch/vault-sync/spec.md`, "Status, notices, guidance" (onboarding, help, language).

**What to build:** When a device connects, a short screen shows the four practices that avoid most conflicts:

- set up one device first;
- connect new devices with an empty or current vault;
- wait for "Synced" before closing or going offline;
- after being offline, sync before editing notes changed elsewhere.

A help section in settings and in the Sync window repeats these and explains conflicts, edits outside the plugin, configuration categories, and skipped files. Everything is in English and Russian.

**Blocked by:** 11 (First sync), 14 (Sync window, notices and reconnect).

**Status:** resolved

- [x] The onboarding screen is shown once per new Connection and can be reopened from help.
- [x] Help is reachable from settings and from the Sync window.
- [x] It covers the four practices, Conflict blocks and Conflict copies (how to clear them), best-effort handling of outside edits, the Metadata folder warning, configuration categories with the secrets warning and the restart, and skipped files.
- [x] Texts are in English and Russian, chosen by Obsidian's language.
- [x] Manual check of both languages on desktop and a phone.

## Comments

- 2026-10-28: Implemented in commit "feat(ui): add onboarding and help" on `feat/onboarding-help`; plan: `.scratch/vault-sync-impl/plans/16-onboarding-help.md`. Ticket closed. The onboarding opens after a new Connection (not a login again) and the sync starts once it is closed; a First sync preview waits behind it. Help is the Sync window's fourth tab, opened from the settings row "Help" and the "Show help" command, with a button showing the four habits again. The manual check of both languages on desktop and a phone is still to do by hand, as are the Android and pair e2e flows, which now close the onboarding after connecting.
- 2026-10-28: Both languages checked on the desktop and on an Android emulator by check 19 (`test/e2e/desktop/onboarding-help.test.ts`, shared with the Android run), in commit "test(e2e): cover onboarding, help, shared settings" on `test/e2e-settings-onboarding`; plan: `.scratch/e2e-settings-onboarding/plan.md`. The settings row "Open help" is checked on the desktop only.
