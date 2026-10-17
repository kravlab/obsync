# Binary conflict policy

Type: grilling
Status: open
Blocked by: none

## Question

When a non-mergeable file (image, PDF, other attachment) changed on both this device and the Remote since the last sync, what does the plugin do? Starting hypothesis to confirm or replace: last-write-wins by modified time, with the losing version silently overwritten. Alternatives include keeping a conflict copy next to the file, or keeping the losing version in a plugin-owned area. Decide the policy, how "newer" is judged when device clocks disagree, and whether the user is told.
