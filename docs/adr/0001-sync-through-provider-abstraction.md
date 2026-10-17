# Sync through a Provider abstraction, Google Drive first

The plugin syncs the vault through a **Provider**, an adapter to one cloud storage service, rather than being built directly on one service's API. Google Drive is the first and, for now, only implemented provider. We decided this because users want a choice of cloud, and because sync engines tied to one API tend to take on that API's model of identity, change tracking and concurrency, which makes adding a second cloud a rewrite. To keep the abstraction from just copying Google Drive's shape, the Provider contract is checked against Dropbox, OneDrive, WebDAV and S3-compatible storage before it is fixed.

## Consequences

- The sync engine may only rely on what the Provider contract guarantees. Capabilities that some providers lack (a change feed, server-side hashes, conditional writes) have to be optional or replaced by the engine's own mechanism.
- Provider-specific words ("Drive", "Google") stay out of engine code, conflict markers, user-facing status and the glossary's generic terms.
