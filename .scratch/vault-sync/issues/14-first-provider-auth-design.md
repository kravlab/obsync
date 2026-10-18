# First provider auth design

Type: grilling
Status: resolved
Blocked by: 03, 15, 16

## Question

How does the user connect the provider chosen in [First provider choice](16-first-provider-choice.md) on each platform? Decide:

- the credential model: an OAuth client shipped with the plugin, one the user registers, or access keys / app passwords;
- the login or redirect flow per platform;
- the scope or permissions requested;
- where credentials are stored;
- what the user sees when credentials stop working.

The decision must stay inside that provider and fit a provider-neutral "connect / disconnect" model that later providers can follow, built around the connect step of the [Provider contract](05-provider-contract.md): authorize, then pick or create the Remote root, or accept a root the provider fixes itself such as an App Folder. Inputs:

- [Provider onboarding and auth for a serverless plugin](15-provider-onboarding-and-auth.md) covers Dropbox, OneDrive, WebDAV and S3.
- If Google Drive is chosen, [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md) applies. It leaves desktop loopback + PKCE, and on mobile either the device flow or a hosted static redirect page (whether the project may host such a page is part of this decision). The scope choice there is `drive.file`, which cannot see files created in the web UI, versus the restricted `drive`, which needs verification.

## Answer

Decided in a grilling session. New glossary term: Connection. New ADR: `docs/adr/0004-dropbox-app-folder-access.md`.

Sources: the Dropbox API spec (`dropbox/dropbox-api-spec`) and the official Dropbox JS and Python SDKs were read verbatim. Dropbox's own web pages could not be opened from the research environment, so statements marked "(search excerpt)" come from search-result excerpts of those pages and must be re-checked before the spec quotes them.

1. **Credential model.** The plugin ships one Dropbox app registered by the plugin author, with its app key bundled in `main.js`. The user registers nothing. PKCE needs no client secret, so a public app key is safe. The author carries the production review (see the map's release item).
2. **Login flow, the same on desktop, Android and iOS.** The plugin opens the Dropbox authorize page in the browser with `response_type=code`, `client_id`, `token_access_type=offline`, the scopes below and `code_challenge_method=S256`, and no `redirect_uri`. Dropbox shows the authorization code, and the user pastes it into the plugin, which exchanges it with the `code_verifier` and no `redirect_uri`. The code is single-use and short-lived (about five minutes per a Dropbox staff forum reply, not documented), so an expired or reused code (`invalid_grant`) simply means starting the login again. No loopback server and no `obsidian://` redirect.
3. **Storage.** The refresh token is stored in Obsidian's `SecretStorage` on each device and never in `data.json`, the vault or the Remote. Each device logs in on its own. Refresh tokens are long-lived and do not rotate (search excerpt); the access token's lifetime is read from `expires_in`.
4. **When credentials stop working.** An `auth` error pauses sync on that device only, with no retries, until the user logs in again. The user gets one notice and a persistent "reconnect needed" status (its look is decided with the status and notices item on the map). The Sync snapshot, Base and Remote settings are kept, so after the login a normal sync follows, not a First sync. Local edits keep accumulating, as when offline.
5. **Access type: App Folder** (ADR 0004). Dropbox creates `Apps/<app folder name>` and every API path is rooted there. The permission type cannot be changed after the app is created (Dropbox staff forum reply, search excerpt). App Folder apps work for Dropbox Business members without admin consent, but a team admin can block third-party apps (search excerpt); that surfaces as an `auth` or `permanent` error.
6. **Remote root.** Each Remote is a subfolder of the App Folder, so one Dropbox account can hold several vaults. The connect step from the [Provider contract](05-provider-contract.md) lists the App Folder's subfolders, marks those holding a Metadata folder as existing Remotes, and offers to create a new one named after the vault by default. A second device picks the same subfolder.
7. **Scopes:** `files.metadata.read` (listing, `list_folder/continue`, `longpoll`, `get_metadata`), `files.content.read` (download), `files.content.write` (upload, delete, create folder, move) and `account_info.read` (`users/get_current_account`), as the API spec assigns them. Nothing else is requested.
8. **Same account only.** On connecting, the plugin records the `account_id` from `users/get_current_account` with the Connection. A login that returns a different `account_id` is refused with an explanation, and the pause continues. To switch accounts the user disconnects and connects again, which is a new Connection with a First sync.
9. **Disconnect.** The plugin calls `auth/token/revoke`, which per the API spec also disables the refresh token behind the access token. If the device is offline or the call fails, the local cleanup still runs, and the user can revoke the app in Dropbox's connected apps. The plugin then erases the token from `SecretStorage` and the device's Sync snapshot, Base, Remote binding and `account_id`. Vault files, the Remote subfolder and its Metadata folder are left untouched. Other devices are not affected: each has its own refresh token (Dropbox staff forum reply, search excerpt).
10. **Provider-neutral connect / disconnect model.**
    - The provider owns: `authorize` (its own login flow, returning a secret to store plus an account id and display name), choosing the Remote root (list and create candidates, or a root it fixes itself), refreshing short-lived access tokens internally (an expired access token, `401 expired_access_token`, is refreshed and the request retried; `invalid_access_token`, or `invalid_grant` on refresh, is reported as `auth`), and `disconnect` (revoking the secret at the service).
    - The plugin owns, the same for every provider: storing the secret in `SecretStorage` under the provider's key and the account id and Remote root on the device, checking the account id on a new login (point 8), the pause on `auth` (point 4) and the local cleanup on disconnect (point 9).

Unverified, carried forward:

- whether linking the app on a new device invalidates the refresh tokens of the others (staff replies say no, one forum reply lists re-approval among `invalid_grant` causes); added to [Mobile runtime checks](17-mobile-runtime-checks.md);
- what happens to the Connection when the user renames or deletes the App Folder, and whether a password change or long inactivity revokes refresh tokens;
- whether the `Apps` folder name is localised.
