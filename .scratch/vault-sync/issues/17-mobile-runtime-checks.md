# Mobile runtime checks

Type: prototype
Status: open
Blocked by: none

## Question

Which runtime behaviours of Obsidian's mobile apps, still unverified, do the sync decisions depend on? First: how large a file can the plugin safely move on Android and iOS, and can downloads be split into parts? [Obsidian platform constraints for sync](02-obsidian-platform-constraints.md) found that `requestUrl` holds the whole request and response in memory, with bodies crossing the mobile bridge as base64. One unverified user report puts crashes at roughly 20–50 MB. Meanwhile the [Provider contract](05-provider-contract.md) passes whole files as one buffer: uploads may be chunked inside the provider, but `read` downloads in one request.

Prototype on real devices (a throwaway plugin driven via `/obsidian-cli` on the host, or a manual checklist):

- the largest `requestUrl` upload and download body that works reliably on Android and on iOS, and what failure looks like (exception, app crash);
- whether a `Range` header passes through `requestUrl` unchanged and gives a `206` partial response, so downloads can be fetched in parts;
- peak memory when reading and writing a large attachment through the Vault/adapter API as one `ArrayBuffer`;
- whether `document` `visibilitychange` fires when the app goes to the background and comes back, and whether `window` `online`/`offline` fire when connectivity changes, on Android and iOS. [Sync triggers and lifecycle](13-sync-triggers-and-lifecycle.md) uses them as sync triggers where available.
- Dropbox, the first provider ([First provider choice](16-first-provider-choice.md)), on Android and iOS:
  - whether a `Dropbox-API-Arg` header carrying a path with escaped non-ASCII characters reaches Dropbox unchanged through `requestUrl`;
  - whether binary upload and download through the Dropbox content endpoint work through `requestUrl`;
  - whether the PKCE paste-the-code login works on a phone: the Dropbox authorize page opens in the browser, and the code can be copied back into Obsidian.

Decide from the results:

- whether the contract's whole-buffer `read`/`write` stands, or gains ranged download as an optional Capability (revising point 10 of the Provider contract answer);
- what safe per-platform size [Synced file scope](11-synced-file-scope.md) can build its ceiling on;
- whether the return-to-app and network-back triggers can rely on those events, or need another signal.
- whether the Dropbox provider works through `requestUrl` on both mobile platforms as planned, or needs a workaround before [First provider auth design](14-first-provider-auth-design.md) and the spec.
