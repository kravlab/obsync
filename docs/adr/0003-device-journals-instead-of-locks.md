# Device journals, not locks, where a provider has no conditional writes

To guarantee that no change is silently lost when two devices sync at once, the engine uses conditional writes where the provider offers them. Where it does not (Google Drive among the candidates), each device keeps its own Device journal in the Metadata folder, writing "intent: X over revision P" before each write and the resulting revision after it, so a device can later see that its revision was overwritten blindly and merge its local version back in. We rejected a sync lease or lock in the Metadata folder because, without conditional writes, acquiring it is itself racy and relies on unverified listing consistency, and because a mobile app killed mid-sync would block every other device until the lease expired. Journals need no waiting, because only their owner writes them.

## Consequences

- Protection on such providers is detect-and-repair: until the overwritten device syncs again, other devices may briefly see a version without its change.
- Journals need pruning once all active devices have read them, plus a "forget this device" action for devices that never return.
- A revision that appears in no journal is treated as an outside edit (best effort).
