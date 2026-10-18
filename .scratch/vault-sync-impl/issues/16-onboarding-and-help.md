# 16: Onboarding and help

Parent spec: `.scratch/vault-sync/spec.md`, "Status, notices, guidance" (onboarding, help, language).

**What to build:** When a device connects, a short screen shows the four practices that avoid most conflicts:

- set up one device first;
- connect new devices with an empty or current vault;
- wait for "Synced" before closing or going offline;
- after being offline, sync before editing notes changed elsewhere.

A help section in settings and in the Sync window repeats these and explains conflicts, edits outside the plugin, configuration categories, and skipped files. Everything is in English and Russian.

**Blocked by:** 11 (First sync), 14 (Sync window, notices and reconnect).

**Status:** ready-for-agent

- [ ] The onboarding screen is shown once per new Connection and can be reopened from help.
- [ ] Help is reachable from settings and from the Sync window.
- [ ] It covers the four practices, Conflict blocks and Conflict copies (how to clear them), best-effort handling of outside edits, the Metadata folder warning, configuration categories with the secrets warning and the restart, and skipped files.
- [ ] Texts are in English and Russian, chosen by Obsidian's language.
- [ ] Manual check of both languages on desktop and a phone.
