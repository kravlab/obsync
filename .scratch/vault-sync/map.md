# Vault sync plugin

Label: wayfinder:map

## Destination

Every decision needed to write the spec for the first release of an Obsidian plugin that syncs one person's vault across desktop, Android and iOS through a Provider abstraction, with Google Drive as the first implemented provider. The map is done when `/to-spec` can run with nothing left to decide.

## Notes

- Domain: Obsidian community plugin in TypeScript. Vocabulary is in `GLOSSARY.md` (Vault, Device, Provider, Remote); the provider decision is `docs/adr/0001-sync-through-provider-abstraction.md`.
- Google Drive sits behind the Provider abstraction and is never the only cloud: no engine decision may assume a capability only Google Drive has. The contract is checked against Dropbox, OneDrive, WebDAV and S3-compatible storage; only Google Drive is implemented.
- User scenario: a single person, several devices, long offline periods with edits on more than one device. Edits made offline on two devices are the normal case.
- Platforms: desktop, Android and iOS are all required.
- Earlier ideas (line-based 3-way merge with inline markers, inline Accept buttons, last-write-wins for binaries, OAuth with PKCE via an `obsidian://` redirect (refuted for Google Drive, see Decisions so far), a provider change feed, a serialized operation queue, debounced local events) are hypotheses. Each is confirmed or replaced by its ticket, never assumed.
- Skills: `obsidian` for any Obsidian API question, `/obsidian-dev-rules` for editor extensions and Vault API detail, `research` for research tickets, `grilling` + `domain-modeling` for grilling tickets, `prototype` for prototype tickets.
- Language: everything on this map is written in English.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Provider capabilities survey](issues/01-provider-capabilities-survey.md): the five providers share none of the following, so the contract can assume none of them: a stable id, a change feed, a permanent cursor, compare-and-swap, a common hash, a settable mtime, atomic rename. Google Drive itself lacks a documented conditional write and allows duplicate names.
- [Obsidian platform constraints for sync](issues/02-obsidian-platform-constraints.md): no background or guaranteed-shutdown hooks on mobile; `requestUrl` is fully buffered, so large transfers must be chunked; hidden paths are reachable only via the adapter, with no events; nothing records changes between sessions, so the plugin needs its own snapshot; per-device state belongs outside `data.json`.
- [Google Drive auth for a community plugin](issues/03-google-drive-auth-for-community-plugin.md): `obsidian://` and copy/paste redirects are dead. Desktop works with a loopback redirect + PKCE. Mobile needs the device flow or a hosted redirect page. `drive.file` needs no verification but is blind to web-created files; `drive` needs restricted verification or a user-supplied client ID.

## Not yet specified

- Settings, status indicator and how sync errors and conflicts are surfaced to the user (status bar, notices, sync log).
- Testing strategy: a fake provider for the engine, mocked `requestUrl`, manual multi-device checks.
- Choosing and connecting a provider in the UI once more than one exists; the provider-neutral connect / disconnect flow.
- Secure storage of credentials on each platform.
- Release and community plugin submission requirements.
- Versioning and migration of the plugin's own sync state format.

## Out of scope

Kept for future efforts; this map does not decide them.

- Real-time collaborative editing: needs a live channel between devices, a different product from async sync.
- Background sync while Obsidian is closed: kept for the future.
- End-to-end encryption of vault contents: kept for the future.
- Syncing one vault to several Remotes at once: kept for the future.
- One vault shared by several people: the target user is a single person.
