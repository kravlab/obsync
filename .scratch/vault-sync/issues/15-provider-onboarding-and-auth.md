# Provider onboarding and auth for a serverless plugin

Type: research
Status: resolved
Blocked by: none

## Question

How can a community Obsidian plugin (desktop via Electron, Android and iOS via Capacitor, HTTP via `requestUrl`, no server of its own) authorize against Dropbox, OneDrive (personal and work/school), WebDAV servers and S3-compatible storage? For each, from primary documentation:

- **OAuth providers (Dropbox, OneDrive):**
  - which app or client types fit a public, serverless client;
  - which redirect URIs are allowed (custom schemes such as `obsidian://…`, loopback, a hosted HTTPS page, no-redirect or code-display flows, device code flow) and which are deprecated or blocked;
  - whether PKCE works without a client secret;
  - refresh token lifetime and rotation.
- **App registration and review** before the general public can use the app: production approval, publisher verification, user caps for unverified apps, scopes that trigger review. Minimal scopes for read/write access to one folder (for example a Dropbox App Folder or OneDrive special/app folders).
- **Non-OAuth providers (WebDAV, S3):**
  - the usual credentials (Basic auth with app passwords, access keys);
  - the setup the user must do: a server URL, a bucket and CORS (irrelevant for `requestUrl`, but confirm), and an IAM policy scoped to one bucket or prefix;
  - whether any part of the flow is impossible on mobile.
- **For each provider, the steps a non-technical user goes through** to connect, and any recurring cost to the plugin author (verification renewals, hosting).

Google Drive is already covered by [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md); include it only in the final comparison. Deliver a per-provider table of workable flows per platform with their costs, then a short ranking by "easiest to ship and to connect", with every claim cited.

## Answer

Findings with primary-source citations: branch `research/provider-onboarding-and-auth` (local, never merged), file `research/provider-onboarding-and-auth.md`. The Dropbox developer guide, the Dropbox OAuth guide and the Nextcloud Login Flow page were re-checked.

Ranking, easiest to ship and to connect first:

1. **Dropbox.**
   - PKCE needs no client secret, and `redirect_uri` is optional: without one, Dropbox shows the code and the user pastes it into the plugin. The same flow works on desktop, Android and iOS.
   - Refresh tokens (`token_access_type=offline`) are long-lived, and approval "remains valid until explicitly revoked". No rotation is documented.
   - An App Folder can hold the Remote.
   - Production review is free, but "once your app links 50 Dropbox users, you will have two weeks to apply for and receive production status approval" before new links freeze. Review starts only at 50 users.
2. **WebDAV (Nextcloud first).**
   - No cost or review for the author.
   - Nextcloud Login Flow v2 needs no app registration or redirect: the plugin POSTs anonymously, opens the login URL, then polls until it receives `server` / `loginName` / `appPassword`; the poll token is valid for 20 minutes.
   - Other servers take a URL plus an app password. RFC 4918 forbids Basic auth over plain HTTP.
3. **OneDrive personal.**
   - Free to ship. The device code flow works on every platform, and desktop can use a localhost redirect on any port.
   - Refresh tokens last 90 days and are replaced on each use.
   - Microsoft's docs disagree on whether the app-folder-only scope works for work/school accounts. A community report from August–September 2026 describes 403 errors.
4. **Google Drive** (see [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md)). Mobile needs the device flow or a hosted redirect page the author must run.
5. **S3-compatible** (R2 and B2 are easier than AWS). Trivial to ship, and no bucket CORS rule is needed with `requestUrl`. Hardest to connect for a non-technical user: a bucket, a scoped key and four values to paste.
6. **OneDrive work/school.** Unverified apps that ask for file access need admin consent by default, and organisations may block the device code flow. Publisher verification requires a registered business, which is impractical for an individual author.

Unverified:

- whether Obsidian mobile delivers `obsidian://` redirects to the plugin (a Dropbox staff forum reply says custom schemes work with PKCE; the reference docs list only HTTPS and localhost);
- whether Microsoft accepts an arbitrary custom scheme for this app type;
- whether `requestUrl` sends an `Origin` header;
- how Obsidian mobile treats plain-HTTP and self-signed WebDAV servers.
