# 08: Conflict copies for binary and JSON files

Parent spec: `.scratch/vault-sync/spec.md`, "Binary conflicts" and "Text merge" (JSON files, Conflict copy name).

**What to build:** When an image, PDF or other non-text file, or a canvas/JSON file that cannot merge cleanly, changed on two devices, both versions survive. The Remote version keeps the original name, and this device's version becomes a Conflict copy next to it, named after the device and time. The user gets a notice.

**Blocked by:** 06 (Text merge and Conflict blocks).

**Status:** ready-for-agent

- [ ] Non-text files never merge. A conflict produces a Conflict copy named `Name (conflict <device name> YYYY-MM-DD HHmm).ext` in the same folder, which syncs as an ordinary file.
- [ ] For `.canvas`/`.json`, a clean merge is applied only if it parses as JSON; otherwise a Conflict copy is made. No markers are ever written into these files.
- [ ] Identical content (same plugin hash) is not a conflict.
- [ ] No device clock decides a winner.
- [ ] A notice is shown, and Conflict copies are recognisable by name so every device can list them.
- [ ] Engine tests cover binary conflict, JSON clean merge, JSON invalid merge, and identical content.
