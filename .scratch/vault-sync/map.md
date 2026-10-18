# Vault sync plugin

Label: wayfinder:map

## Destination

Every decision needed to write the spec for the first release of an Obsidian plugin that syncs one person's vault across desktop, Android and iOS through a Provider abstraction, with one provider implemented first. Which one is itself a decision on this map, made on ease of implementation and of connecting it. The map is done when `/to-spec` can run with nothing left to decide.

## Notes

- Domain: Obsidian community plugin in TypeScript. Vocabulary is in `GLOSSARY.md` (Vault, Device, Provider, Remote, Metadata folder, Sync snapshot). Decisions with lasting weight are ADRs in `docs/adr/`.
- Every cloud sits behind the Provider abstraction, and no engine decision may assume a capability only one provider has. The contract is checked against Google Drive, Dropbox, OneDrive, WebDAV and S3-compatible storage. Exactly one of them is implemented for the first release: Dropbox (see [First provider choice](issues/16-first-provider-choice.md)).
- User scenario: a single person, several devices, long offline periods with edits on more than one device. Edits made offline on two devices are the normal case.
- Platforms: desktop, Android and iOS are all required.
- Earlier ideas (line-based 3-way merge with inline markers, inline Accept buttons (replaced by visible markers with an action row, see Decisions so far), last-write-wins for binaries (rejected, see Decisions so far), OAuth with PKCE via an `obsidian://` redirect (refuted for Google Drive, see Decisions so far), a provider change feed, a serialized operation queue, debounced local events) are hypotheses. Each is confirmed or replaced by its ticket, never assumed.
- Skills: `obsidian` for any Obsidian API question, `/obsidian-dev-rules` for editor extensions and Vault API detail, `research` for research tickets, `grilling` + `domain-modeling` for grilling tickets, `prototype` for prototype tickets.
- Language: everything on this map is written in English.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Obsidian platform constraints for sync](issues/02-obsidian-platform-constraints.md): no background or guaranteed-shutdown hooks on mobile; `requestUrl` is fully buffered, so large transfers must be split into requests below a measured per-request limit (see [Mobile runtime checks](issues/17-mobile-runtime-checks.md)); hidden paths are reachable only via the adapter, with no events; nothing records changes between sessions, so the plugin needs its own snapshot; per-device state belongs outside `data.json`.
- [Google Drive auth for a community plugin](issues/03-google-drive-auth-for-community-plugin.md): `obsidian://` and copy/paste redirects are dead. Desktop works with a loopback redirect + PKCE. Mobile needs the device flow or a hosted redirect page. `drive.file` needs no verification but is blind to web-created files; `drive` needs restricted verification or a user-supplied client ID.
- [Provider capabilities survey](issues/01-provider-capabilities-survey.md): the five providers share none of the following, so the contract can assume none of them: a stable id, a change feed, a permanent cursor, compare-and-swap, a common hash, a settable mtime, atomic rename. Google Drive itself lacks a documented conditional write and allows duplicate names.
- [Remote layout and change detection](issues/04-remote-layout-and-change-detection.md): the Remote is a plain mirror of exactly one vault, with plugin data only in one Metadata folder. Changes are found by a full listing compared with the Sync snapshot, using per-file revision tokens, with an optional change feed and no shared manifest. Unmirrorable names are skipped or encoded, by a per-Remote setting. Folders are entries.
- [Provider onboarding and auth for a serverless plugin](issues/15-provider-onboarding-and-auth.md): ranked by ease of shipping and connecting: Dropbox (PKCE + paste-the-code on all platforms, free review at 50 users), then WebDAV/Nextcloud (Login Flow v2, nothing to register), OneDrive personal, Google Drive, S3-compatible, and last OneDrive work/school.
- [Provider contract](issues/05-provider-contract.md): a thin, path-addressed file API (list/read/write/delete/createFolder). Change feed, conditional write and file/folder move are optional Capabilities reported after connecting. Ten error categories with retries done by the engine. The engine applies the name policy using provider-declared name rules. Whole-buffer transfers, a connect step that picks the root, and the Metadata folder handled through the same operations.
- [Concurrent sync from several devices](issues/06-concurrent-sync-from-several-devices.md): no change is silently lost on any provider. Conditional writes are used where available. Elsewhere, per-device Device journals (intent before write) let an overwritten device detect the overwrite and merge back. A folder is deleted only when empty. Shared Remote settings use guarded writes, and sync stops on a collision.
- [Text conflict merge policy](issues/07-text-conflict-merge-policy.md): line-based 3-way merge against a per-device Base, with conflicts written as Conflict blocks labelled with device names. With no true Base, a 2-way merge marks every difference. Text means a shared extension list plus a UTF-8 check, compared with LF/BOM normalised. JSON files get a Conflict copy instead of markers.
- [Binary conflict policy](issues/08-binary-conflict-policy.md): silent last-write-wins is rejected. On a conflict the Remote version keeps the name and the detecting device's version becomes a Conflict copy. No clocks are involved, identical hashes are no conflict, and a notice plus the conflict list tell the user.
- [Inline conflict resolution UI](issues/09-inline-conflict-resolution-ui.md): variant B wins. Markers stay visible with an action row above each block (keep mine, keep theirs, keep both, Edit… dialog); on phones the row becomes 44px buttons. Reading view shows both sides without buttons, there are next/previous-conflict commands, and it ships in the first release.
- [Deletions and renames](issues/10-deletions-and-renames.md): deletions are found from the Sync snapshot, with no Remote tombstones. An edit beats a delete, and local deletes go to the user's trash. A Deletion guard stops mass deletes for confirmation. Renames are detected by event, stable id or unique hash and applied with `vault.rename` (no link rewrite). Rename combined with an edit or delete keeps the file. With two different names the Remote name wins, and an occupied target becomes a Conflict copy.
- [First sync against an existing Remote](issues/12-first-sync-against-existing-remote.md): a device with no Sync snapshot does a union-only First sync with no deletes. A preview with a summary comes first, offering a bulk "Remote + Conflict copies" option. Identical files are matched by hash, using the server hash when the algorithm matches. A lost snapshot means re-registering, and a simultaneous Remote setup is a settings collision.
- [Sync triggers and lifecycle](issues/13-sync-triggers-and-lifecycle.md): sync runs on vault open, manual command, post-edit pause, polling, and return to app or network where available, one sync at a time. There is no persisted queue: an interrupted sync re-derives its work from vault, Sync snapshot and Remote. Local changes are found by a scan, with events as hints. The open note waits for a typing pause, uploads go first, and offline is a normal state.
- [First provider choice](issues/16-first-provider-choice.md): Dropbox is the first provider (PKCE + paste-the-code on all platforms, App Folder). The first release builds only the conditional-write path, with no Device journals: a provider without conditional writes is refused until they exist. Dropbox implements the `changes` Capability, falling back to a full listing on `cursorLost`. Its mobile risks are checked in [Mobile runtime checks](issues/17-mobile-runtime-checks.md).
- [First provider auth design](issues/14-first-provider-auth-design.md): the plugin ships its own Dropbox app key (PKCE, no secret) with paste-the-code login on every platform and four scopes. App Folder access, with each Remote a subfolder picked at connect time. The refresh token lives in `SecretStorage` per device. An `auth` error pauses sync until a login to the same account. Disconnect revokes and clears local state only. The provider owns login, token refresh and revoke; the plugin owns the Connection's storage, account check, pause and cleanup.
- [Mobile runtime checks](issues/17-mobile-runtime-checks.md): measured on Android and iOS with a probe plugin. The contract stays whole-buffer (100 MB in memory is fine on both), while the provider keeps each HTTP request under 20 MB (Android crashed downloading 30 MB) via upload sessions and `Range`; the limit is user-configurable. `visible` and `online` work as triggers, `hidden` does not. Dropbox works on both. Templater JS can install plugins on iOS.

## Not yet specified

- Settings, status indicator and how sync errors and conflicts are surfaced to the user (status bar, notices, sync log, one conflict list covering files with Conflict blocks and Conflict copies), plus the Deletion guard prompt (apply / restore / review list) and notices for restored or renamed files, and the First sync preview.
- Testing strategy: a fake provider for the engine, mocked `requestUrl`, manual multi-device checks.
- Choosing a provider in the UI once more than one exists.
- Release and community plugin submission requirements, including Dropbox production review: once 50 users link the app, approval must be obtained within two weeks or new links freeze. The Dropbox app name may not contain "Dropbox", cannot change after production status, and by default names the user's `Apps/` folder.
- Versioning and migration of the plugin's own sync state format.

## Out of scope

Kept for future efforts; this map does not decide them.

- Real-time collaborative editing: needs a live channel between devices, a different product from async sync.
- Background sync while Obsidian is closed: kept for the future.
- End-to-end encryption of vault contents: kept for the future.
- Syncing one vault to several Remotes at once: kept for the future.
- One vault shared by several people: the target user is a single person.
