# First provider choice

Type: grilling
Status: resolved
Blocked by: 15

## Question

Which provider is implemented for the first release? Google Drive is not required. Choose the one that is simplest to implement well and to connect on desktop, Android and iOS. Weigh:

- engine fit: change feed, revision tokens, conditional writes, name rules, and how much fallback code it forces;
- auth and onboarding on mobile without a server;
- app review and verification burden;
- setup steps for the user;
- how many users already have an account with it;
- risks that need prototyping.

Inputs: [Provider contract](05-provider-contract.md) (which optional Capabilities a candidate offers and how much engine fallback it leaves), [Provider capabilities survey](01-provider-capabilities-survey.md), [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md), [Provider onboarding and auth for a serverless plugin](15-provider-onboarding-and-auth.md).

## Answer

Decided in a grilling session.

1. **Dropbox is the first provider.** It ranked first in [Provider onboarding and auth for a serverless plugin](15-provider-onboarding-and-auth.md): PKCE with no client secret, and with no `redirect_uri` Dropbox shows the authorization code for the user to paste into the plugin, the same flow on desktop, Android and iOS, with no server. Refresh tokens are long-lived, and an App Folder can fix the Remote root. Third-party API apps do not count toward the Dropbox Basic device limit, which covers only the official Dropbox apps (a Dropbox staff reply in the Dropbox Community thread "Three devices limit and API access"; old, not re-confirmed).
2. **No Device journals in the first release.** Dropbox offers the conditional-write Capability for both operations the engine needs: upload in `update` mode with the known revision, and `delete_v2` with `parent_rev` (files only; folders are deleted only when empty, per [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md)). The first release builds only the conditional-write path. The engine refuses to connect a provider that does not report conditional writes until Device journals are implemented. The contract is unchanged, and `docs/adr/0003-device-journals-instead-of-locks.md` still stands for later providers (WebDAV, Google Drive).
3. **The Dropbox provider implements the `changes` Capability in the first release.** The recursive `list_folder` listing already returns a cursor, and `list_folder/continue` returns only what changed, so polling does not re-list the whole vault. A cursor reset (409) maps to `cursorLost`, and the engine falls back to the full listing that [Remote layout and change detection](04-remote-layout-and-change-detection.md) already requires.
4. **Dropbox risks are checked in [Mobile runtime checks](17-mobile-runtime-checks.md)**, with the same throwaway plugin: the escaped non-ASCII `Dropbox-API-Arg` header through `requestUrl`, binary upload and download through the Dropbox content endpoint, and the PKCE paste-the-code login on a phone.

Known costs carried forward:

- Production review is free, but once 50 users link the app, approval must be obtained within two weeks or new links freeze (recorded under release requirements in the map's Not yet specified).
- Dropbox names are case-insensitive, so names differing only by case are skipped and reported under the name policy of the [Provider contract](05-provider-contract.md).
- Deletion entries in the change feed carry a path but no id, which the path-addressed contract already accepts.
- What `delete_v2` returns on a `parent_rev` mismatch was not found in the sources checked; the provider maps it to `preconditionFailed` once confirmed.
