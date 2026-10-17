# Text conflict merge policy

Type: grilling
Status: open
Blocked by: none

## Question

When a text file changed on both this device and the Remote since the last sync, what does the plugin do? Starting hypothesis to confirm or replace: a line-based 3-way merge against the last synced version (the common ancestor); clean hunks merge automatically, conflicting hunks are written into the file as git-style markers, and the file stays usable with the markers left in place. Decide:

- The merge granularity and library (line-based diff3 or other) and its fit for mobile.
- Marker format and labels, using provider-neutral words (e.g. Local / Remote, not a service name), and whether device names appear.
- Where and how the common ancestor is stored, and what happens when it is missing.
- Which files count as text (by extension? by content?), encoding, and line-ending normalisation.
- What happens when a file that already contains unresolved markers conflicts again.
