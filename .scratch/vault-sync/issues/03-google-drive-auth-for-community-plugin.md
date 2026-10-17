# Google Drive auth for a community plugin

Type: research
Status: resolved
Blocked by: none

## Question

How can a community Obsidian plugin, with no server of its own, authorize against Google Drive on desktop, Android and iOS? Find out from Google's primary documentation:

- Which OAuth client types fit (web, desktop/installed, iOS, Android) and which redirect URIs each allows: a custom scheme such as `obsidian://…`, loopback `http://127.0.0.1`, others. Which of these flows are deprecated or blocked.
- Whether PKCE works without a client secret for each type, and whether a secret shipped in a public plugin is acceptable to Google.
- Scope options (`drive.file`, `drive`, `drive.appdata`, …): what each can see, in particular whether `drive.file` sees files the user creates or edits through the Drive web UI or another device's app, and whether "files created by the app" is per OAuth client.
- App verification requirements per scope (sensitive / restricted), the unverified-app user cap, and refresh token lifetime while an app is in "testing" status.
- Token refresh behaviour: when Google rotates or revokes refresh tokens.

Deliver which combinations of client type, redirect and scope actually work on each platform, with their costs (verification, user-supplied client id, etc.).

## Answer

Findings with primary-source citations: branch `research/google-drive-auth` (local, never merged), file `research/google-drive-auth.md`. Key claims re-checked against Google's native-app and OAuth 2.0 overview pages.

- **Ruled out on every platform:**
  - custom URI schemes such as `obsidian://` as the Google redirect ("no longer supported due to the risk of app impersonation");
  - the out-of-band copy/paste flow ("no longer supported");
  - loopback redirects for Android and iOS client types (deprecated or blocked).
- **Desktop:** the documented path is a Desktop-app client with a loopback `http://127.0.0.1:<port>` redirect, PKCE (S256) and `drive.file`. It needs a Node `http` listener (desktop only), and the client ID and "secret" ship inside the plugin. Google says an installed app's secret is not treated as secret, though its policy warns against publishing credentials.
- **Mobile:** the plugin cannot use native client types (it can't register its own URL scheme or call native SDKs). The remaining options:
  - **(a) Device flow** (TVs and Limited Input client). Uses only HTTPS calls; the user types a code at google.com/device. Only `drive.file`/`drive.appdata` are allowed, there is no Picker, and it is a platform mismatch under Google's policy.
  - **(b) Web client with a hosted HTTPS redirect page** that forwards the code to `obsidian://…`. Needs a domain and hosting and a web client secret in public code. Whether the token exchange works without the secret is unverified.
- **Scopes:**
  - `drive.file` and `drive.appdata` are non-sensitive: no verification and no user cap.
  - `drive` and `drive.readonly` are restricted: an annual verification of about 6 weeks, a possible security assessment (unverified for a serverless plugin), and until verified a 100-user lifetime cap with an "unverified app" screen.
  - `drive.file` does not see files created in the Drive web UI unless they are picked through the Picker. The grant is inferred to be per Cloud project, so all devices should use clients in one project.
- **User-supplied client ID** (each user creates a Cloud project): the full `drive` scope becomes usable under the personal-use exemption. The cost is heavy setup, and the project must be "In production" because in Testing refresh tokens expire after 7 days. Unused clients may be deleted after 6 months.
- **Refresh tokens:** no documented rotation. They die when the user revokes access, after 6 months unused, or beyond 100 tokens per Google account per client (the oldest is dropped silently). The revoke endpoint logs out every client in the project, so "disconnect" on one device disconnects all of them.
