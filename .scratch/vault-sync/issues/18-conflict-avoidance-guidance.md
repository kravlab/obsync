# Conflict-avoidance guidance for users

Type: grilling
Status: open
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
