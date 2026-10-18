# Sync triggers and lifecycle

Type: grilling
Status: resolved
Blocked by: 02

## Question

When does a sync run, and what happens when it is interrupted? Decide the triggers (vault open, interval, local file changes with debounce, app returning to the foreground on mobile, manual command), how often the Remote is polled, how a sync cut off mid-way (app backgrounded, network lost, Obsidian closed) is made safe to resume, and how local changes made while offline are queued. Constrained by mobile lifecycle facts in [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md).

Per [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md), every sync starts by re-reading the shared Remote settings and the other devices' journals. On providers without conditional writes, an interrupted write leaves an incomplete intent entry in the Device journal, which the device must complete or retract on resume.

## Answer

Decided in a grilling session.

1. **Triggers:**
   - opening the vault (after `onLayoutReady`) and a manual "Sync now" command;
   - a local edit, once the vault has been quiet for a short pause;
   - periodic polling while Obsidian is open;
   - returning to the app and the network coming back, where the platform delivers those events.

   The pause length and the polling interval are settings, with defaults left to the spec. At most one sync runs at a time per device; triggers that fire during a sync collapse into one follow-up sync.
2. **Interruption** (app backgrounded, network lost, Obsidian closed). There is no persisted operation queue. The Sync snapshot is updated per file only after both sides confirm the result. The next sync re-derives the work by comparing vault, Sync snapshot and Remote, and finishes what was left. Incomplete intent entries in the Device journal are completed or retracted, per [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md).
3. **Local changes** are found by comparing the vault with the Sync snapshot, so edits made offline or while Obsidian was closed are found too. A full walk runs on vault open and on every poll: mtime and size first, hashing only what changed. Vault events only mark paths for a quick sync.
4. **The note being edited.** A remote change to the open note is processed only after the same typing pause; merging follows the conflict policies. Other files sync immediately. How to write into an open editor without disturbing the cursor is left to the spec.
5. **Order of work.** Local changes go to the Remote first, small text files before large attachments; downloads follow. Mobile apps can be frozen within seconds of backgrounding, and until uploaded, local edits exist only on this device.
6. **Offline is a normal state, not an error.** Attempts fail as `transient` and retry with growing backoff and on triggers. The status shows "offline" without repeated notices, and no queue is kept, because the next scan finds the edits.
7. **Unverified mobile events.** Whether `visibilitychange` (return to the app) and `online` fire in Obsidian's mobile app is checked in [Mobile runtime checks](17-mobile-runtime-checks.md). Until confirmed, polling and the post-edit trigger cover those cases.
