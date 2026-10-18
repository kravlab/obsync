# Text conflict merge policy

Type: grilling
Status: resolved
Blocked by: none

## Question

When a text file changed on both this device and the Remote since the last sync, what does the plugin do? Starting hypothesis to confirm or replace: a line-based 3-way merge against the last synced version (the common ancestor); clean hunks merge automatically, conflicting hunks are written into the file as git-style markers, and the file stays usable with the markers left in place. Decide:

- The merge granularity and library (line-based diff3 or other) and its fit for mobile.
- Marker format and labels, using provider-neutral words (e.g. Local / Remote, not a service name), and whether device names appear.
- Where and how the common ancestor is stored, and what happens when it is missing.
- Which files count as text (by extension? by content?), encoding, and line-ending normalisation.
- What happens when a file that already contains unresolved markers conflicts again.

Since [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md), this policy also repairs blind overwrites detected through Device journals. In that case the common ancestor is the revision the overwriting device built on, and its content may not be available locally, so the missing-base rule must cover this case too.

## Answer

Decided in a grilling session. New glossary terms: Base, Conflict block, Conflict copy.

1. **Approach.** A line-based 3-way merge against the Base. Changes that don't overlap merge automatically; overlapping ones become a **Conflict block** with git-style markers. The file stays ordinary markdown, and the user can remove the markers by hand at any time with no special plugin action. The next sync uploads the edited file.
2. **What counts as text:**
   - the extension is in the text-extension list, and all three versions decode as valid UTF-8;
   - the default list is `.md`, `.txt`, `.canvas`, `.csv` and similar, with the exact list left to the spec;
   - the user can add extensions;
   - the list is a shared Remote setting, like the name policy, so every device classifies a file the same way.

   Everything else follows [Binary conflict policy](08-binary-conflict-policy.md).
3. **Line endings and BOM.** All three versions are normalised to LF without BOM for merging. The result is written in the local file's style (its line endings and BOM). A difference only in line endings is not a conflict.
4. **The Base** is a local copy, kept by each device, of every synced text file's content at that device's last successful sync. It is part of the Sync snapshot: outside the vault, never synced.
5. **Missing or wrong Base** (lost Sync snapshot, or repair of a blind overwrite found through a Device journal, see [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md)). A Base that is not the true common ancestor is never used. The engine does a 2-way merge instead: common lines appear once, and every region where the versions differ becomes a Conflict block. No side is chosen automatically. Identical versions are not a conflict.
6. **Labels.** `<<<<<<< <this device's name>` … `=======` … `>>>>>>> <other device's name>`. When the other device is not known from a Device journal, the second label is `Remote`. The marker syntax is exactly git's.
7. **A file that already has unresolved markers** merges as usual. Old markers are ordinary text, so a nested block may appear, but nothing is lost.
8. **Structured text (`.canvas`, `.json`).** A clean merge is applied only if the result parses as valid JSON. Otherwise, and on any conflict, no markers are written: the Remote version goes into the file, and the local version is kept as a **Conflict copy**.
9. **Conflict copy.** A sibling file in the same folder, named like `Name (conflict <device name> YYYY-MM-DD HHmm).ext`. The time comes from the device clock and is for people only. It is an ordinary vault file and syncs to every device. The exact format is left to the spec.
10. **The merge library** is chosen in the spec: pure JavaScript, no Node built-ins, works on mobile.
