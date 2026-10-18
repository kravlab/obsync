# Conflict-avoidance guidance for users

Type: grilling
Status: resolved
Blocked by: 11, 13

## Question

What guidance does the plugin give the user, inside the plugin itself, on how to use it without producing conflicts, and where and when does it appear? Decide:

- **Content.** Which practices are recommended, each tied to the decision that makes it matter. A starting point from the user: do not set up the plugin on other devices until the first device has finished its First sync. Other candidates:
  - let a device finish syncing before editing the same notes elsewhere;
  - sync before going offline, and right after coming back online;
  - don't edit the Remote outside the plugin;
  - what Conflict blocks and Conflict copies mean and how to clear them.
- **Placement.** Candidates:
  - an onboarding step when connecting;
  - the [First sync against an existing Remote](12-first-sync-against-existing-remote.md) preview;
  - a help section in settings;
  - contextual notices when a risky situation is detected (for example, another device's First sync is in progress on the same Remote).
- **Guidance or enforcement.** Whether any of these practices is enforced by the plugin rather than only explained.

Inputs:

- the guarantees and behaviours already decided on the map: [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md), [Text conflict merge policy](07-text-conflict-merge-policy.md), [Binary conflict policy](08-binary-conflict-policy.md), [Deletions and renames](10-deletions-and-renames.md), [First sync against an existing Remote](12-first-sync-against-existing-remote.md);
- the still-open [Sync triggers and lifecycle](13-sync-triggers-and-lifecycle.md) and [Synced file scope](11-synced-file-scope.md), whose answers change what users must know.

Since [Synced file scope](11-synced-file-scope.md), the guidance should also cover: per-device config categories and the secrets warning for plugin settings; the restart needed after config changes; skipped files (dot-paths, ignore list, size ceiling); and that config conflicts keep the local version in the plugin folder.

## Answer

Decided in a grilling session.

1. **Recommended practices** (each tied to the decision that makes it matter):
   - **One device first.** Do not connect other devices until the first one has finished its First sync. See [First sync against an existing Remote](12-first-sync-against-existing-remote.md).
   - **Connect a new device with an empty vault, or a copy known to be current.** A First sync only adds and merges, so files that another device deleted come back from a stale copy. See [First sync against an existing Remote](12-first-sync-against-existing-remote.md) and [Deletions and renames](10-deletions-and-renames.md).
   - **Wait for the "synced" status before closing Obsidian or going offline.** iOS freezes JavaScript in the background, and Android may restart the app. See [Sync triggers and lifecycle](13-sync-triggers-and-lifecycle.md) and [Mobile runtime checks](17-mobile-runtime-checks.md).
   - **After being offline, let a sync finish before editing notes that may have changed on another device.** See [Text conflict merge policy](07-text-conflict-merge-policy.md) and [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md).
2. **Explanations:**
   - **Conflicts:** what Conflict blocks and Conflict copies are, and how to clear them (the Keep…/Edit… actions, deleting markers by hand, deleting a copy).
   - **Edits outside the plugin:** they are handled best effort only, and the Metadata folder must not be touched.
   - **Configuration:** per-device categories, possible secrets in other plugins' settings, the restart after configuration changes, and where the local version goes on a configuration conflict. See [Synced file scope](11-synced-file-scope.md).
   - **Skipped files:** dot-paths, the ignore list, the size ceiling and names that cannot be mirrored, plus where to see the list of skipped files.
3. **Placement:**
   - **Onboarding screen:** a short screen during connecting, with the four practices and a link to the help section. It is shown once per new Connection on a device and can be reopened from help.
   - **Help section in settings:** everything in points 1–2.
4. **The plugin warns about "one device first".** While a device runs its First sync, its device record in the Metadata folder carries a "First sync in progress" mark, removed when the First sync finishes. A device that connects while another device's mark is present advises waiting, and the user may continue at their own risk. A mark left behind by a killed app expires after a timeout set by the spec.
5. **Language.** The whole plugin UI, this guidance included, ships in English and Russian from the first release, chosen by Obsidian's language.
