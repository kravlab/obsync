# Sync triggers and lifecycle

Type: grilling
Status: open
Blocked by: 02

## Question

When does a sync run, and what happens when it is interrupted? Decide the triggers (vault open, interval, local file changes with debounce, app returning to the foreground on mobile, manual command), how often the Remote is polled, how a sync cut off mid-way (app backgrounded, network lost, Obsidian closed) is made safe to resume, and how local changes made while offline are queued. Constrained by mobile lifecycle facts in [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md).
