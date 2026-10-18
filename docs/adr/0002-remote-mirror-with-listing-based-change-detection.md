# Remote is a plain mirror; changes are found by listing, not by a shared manifest

The Remote holds the vault as a plain mirror, at the same relative paths and readable in the provider's own UI. A device finds remote changes by comparing a full listing of the Remote (or, where the provider offers one, its change feed) with its own Sync snapshot, using each file's opaque revision token. We rejected a content-addressed store because it makes the notes unreadable without the plugin. We rejected an authoritative manifest on the Remote because every device would have to rewrite it, and some candidate providers, Google Drive among them, have no documented conditional write to stop two devices from overwriting each other's manifest. A manifest would also miss edits made outside the plugin, which are supported best effort.

## Consequences

- Every provider must support a full listing. A change feed is optional and only an accelerator, with "cursor lost → full listing" as the recovery path.
- Names a provider cannot mirror faithfully are skipped and reported or encoded reversibly, by a setting stored per Remote.
- Plugin-owned data on the Remote is confined to one Metadata folder.
