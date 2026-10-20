# 08: Conflict copies for binary and JSON files

Parent spec: `.scratch/vault-sync/spec.md`, "Binary conflicts" and "Text merge" (JSON files, Conflict copy name).

**What to build:** When an image, PDF or other non-text file, or a canvas/JSON file that cannot merge cleanly, changed on two devices, both versions survive. The Remote version keeps the original name, and this device's version becomes a Conflict copy next to it, named after the device and time. The user gets a notice.

**Blocked by:** 06 (Text merge and Conflict blocks).

**Status:** resolved

- [ ] Non-text files never merge. A conflict produces a Conflict copy named `Name (conflict <device name> YYYY-MM-DD HHmm).ext` in the same folder, which syncs as an ordinary file.
- [ ] For `.canvas`/`.json`, a clean merge is applied only if it parses as JSON; otherwise a Conflict copy is made. No markers are ever written into these files.
- [ ] Identical content (same plugin hash) is not a conflict.
- [ ] No device clock decides a winner.
- [ ] A notice is shown, and Conflict copies are recognisable by name so every device can list them.
- [ ] Engine tests cover binary conflict, JSON clean merge, JSON invalid merge, and identical content.

## Comments

- 2026-10-20: Implemented in commit `84db038` (feat(conflicts): keep Conflict copies of files) on `feat/conflict-copies`; plan: `.scratch/vault-sync-impl/plans/08-conflict-copies.md`. Ticket closed. The notice popping up in Obsidian is still to be checked by hand; the conflict list that shows Conflict copies on every device comes with ticket 14.
