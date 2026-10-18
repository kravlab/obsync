# Binary conflict policy

Type: grilling
Status: resolved
Blocked by: none

## Question

When a non-mergeable file (image, PDF, other attachment) changed on both this device and the Remote since the last sync, what does the plugin do? Starting hypothesis to confirm or replace: last-write-wins by modified time, with the losing version silently overwritten. Alternatives include keeping a conflict copy next to the file, or keeping the losing version in a plugin-owned area. Decide the policy, how "newer" is judged when device clocks disagree, and whether the user is told.

Since [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md), this policy also decides the outcome when a Device journal shows that a binary file was overwritten blindly by another device. Ordering must come from revisions, not device clocks.

[Text conflict merge policy](07-text-conflict-merge-policy.md) introduced the Conflict copy (a sibling `Name (conflict <device> YYYY-MM-DD HHmm).ext`, synced like any file). Decide whether binary conflicts use it too. Files that fail the text check (wrong extension or not UTF-8) land in this policy.

## Answer

Decided in a grilling session. The starting hypothesis, silent last-write-wins, is rejected: it contradicts the "no change is silently lost" guarantee of [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md).

1. **Policy: Conflict copy.** No version is ever silently overwritten.
2. **Which version keeps the name.** The device that detects the conflict puts the Remote version into the original file and uploads its own local version as a Conflict copy next to it, using the format from [Text conflict merge policy](07-text-conflict-merge-policy.md). The same rule applies when a Device journal shows that a binary file was blindly overwritten. No "newer" judgement is made and device clocks play no part: both versions survive.
3. **Identical content** (same plugin-computed content hash) is not a conflict. Only the Sync snapshot is updated.
4. **Notification.** The device that creates a Conflict copy shows a notice. Every device lists Conflict copies, recognised by their name format, among the vault's conflicts. How notices and the conflict list look belongs to the "settings, status and how errors and conflicts are surfaced" fog on the map.
5. **Scope.** The policy covers every file that fails the text check: an extension outside the shared text-extension list, or content that is not valid UTF-8.
