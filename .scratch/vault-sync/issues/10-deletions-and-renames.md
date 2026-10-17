# Deletions and renames

Type: grilling
Status: open
Blocked by: 04

## Question

How are deletions and renames carried between devices without losing data? Decide: how a device tells "deleted elsewhere" from "never synced here" (tombstones, sync state, or the Remote's trash), what happens when one side deletes and the other edits, whether a rename is propagated as a move or as delete + create, how a rename on one side meets an edit on the other, and what guard stops a mass deletion (e.g. a vault wiped on one device) from spreading to the Remote and all other devices. Builds on [Remote layout and change detection](04-remote-layout-and-change-detection.md).
