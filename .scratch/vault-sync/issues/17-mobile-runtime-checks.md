# Mobile runtime checks

Type: prototype
Status: resolved
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
  - whether the PKCE paste-the-code login works on a phone: the Dropbox authorize page opens in the browser, and the code can be copied back into Obsidian;
  - whether linking the app on a second device leaves the first device's refresh token working ([First provider auth design](14-first-provider-auth-design.md) assumes one independent refresh token per device).

Decide from the results:

- whether the contract's whole-buffer `read`/`write` stands, or gains ranged download as an optional Capability (revising point 10 of the Provider contract answer);
- what safe per-platform size [Synced file scope](11-synced-file-scope.md) can build its ceiling on;
- whether the return-to-app and network-back triggers can rely on those events, or need another signal.
- whether the Dropbox provider works through `requestUrl` on both mobile platforms as planned, or needs a workaround before [First provider auth design](14-first-provider-auth-design.md) and the spec.

## Comments

### Android run (2026-10-18, Obsidian API 1.14.4)

Probe: branch `prototype/mobile-runtime-checks`, `.scratch/vault-sync/prototypes/mobile-runtime-checks/`.

- **Dropbox PKCE paste-the-code login works.** The authorize page opened in the browser, the code exchanged without `redirect_uri`, and a refresh token was returned with all four scopes. Reusing a code gives `invalid_grant` ("code doesn't exist or has expired"), so codes are single-use.
- **Non-ASCII `Dropbox-API-Arg` works.** A path with Cyrillic, CJK and diacritics, escaped as `\uXXXX`, uploaded with the exact name, appeared in `list_folder`, and downloaded intact.
- **`Range` works through `requestUrl`:** `bytes=0-1023` returned `206`, 1024 bytes, `content-range: bytes 0-1023/4096`, with matching content.
- **`requestUrl` body size.** Upload and download of 1, 5, 10 and 20 MB work, with matching SHA-256. A **50 MB upload crashes the app**, reproduced twice: no `upload ok` line, and the plugin reloads 17–18 s later. Generating and hashing 50 MB in memory did not crash in the vault check, so the crash is in the `requestUrl` upload. The 30 and 40 MB sizes were added to narrow the limit.
- **Vault adapter `writeBinary`/`readBinary`** works up to 100 MB with matching hashes: 100 MB took 13.3 s to write and 0.9 s to read.
- **`online`/`offline` fire** on airplane mode.
- **`visibilitychange`.** `visible` fired on every return. `hidden` fired only once, when the browser opened for login; other trips to the background logged only `blur`.
- **Timers kept running in the background,** delayed by under a second; no long freeze was seen on Android.
- **Second device.** After logging in on a second device, "Refresh now" on the first device returned `refresh ok`, so one device's refresh token survives another device linking.

- **Narrowed limit (second Android run).** 30 MB: upload succeeded (27.7 s), then the app crashed during the download; the plugin reloaded 15 s later. Whole-buffer download is safe up to 20 MB and crashes at 30 MB; upload passes 30 MB and crashed at 50 MB. 40 MB was not run: the probe downloads right after uploading, so it would hit the same download crash.
- **`visibilitychange -> hidden`** fired on a later trip to the background (19:48:33), so `hidden` is delivered sometimes, not always.
- **The app was restarted in the background** with no check running: `blur` at 19:52:15, then the plugin loaded again at 19:52:46. This supports the decision that any sync step must survive being cut off.

### iOS run (2026-10-18, Obsidian API 1.13.7)

Installed without access to hidden folders: a note carrying the probe as base64 was run with the community plugin Templater ("Replace templates in the active file"), whose JavaScript execution command wrote the files into the config folder. JavaScript execution commands therefore work on iOS. (The iOS Files-style app tried first, Taio, showed a stale copy of the vault, not the live folder.)

- **Dropbox login, non-ASCII path, `Range`:** all work, with the same results as on Android.
- **`requestUrl` body size:** upload and download of 10, 20, 30, 40 and 50 MB all work, with matching SHA-256. 100 MB was not offered for the network check.
- **Vault adapter** works up to 100 MB (100 MB: 1.3 s write, 0.2 s read).
- **`visibilitychange`:** both `hidden` and `visible` fire on every trip to the background; `focus`/`blur` also fire. **`online`/`offline` fire.**
- **JavaScript is frozen in the background:** the 30-second heartbeat stops while the app is hidden (gaps of about 70–100 s) and resumes on return.
- **Token refresh** works after both devices are linked.
- `performance.memory` is not available on iOS.

## Answer

Decided with the user from the Android and iOS probe runs above. Probe: branch `prototype/mobile-runtime-checks` (local, never merged), `.scratch/vault-sync/prototypes/mobile-runtime-checks/`, including `Install vault-sync-probe.md`, the Templater-based installer used on iOS.

1. **The Provider contract stays whole-buffer.** Point 10 of [Provider contract](05-provider-contract.md) is unchanged: `read` returns and `write` takes the whole file as one buffer, because memory handled 100 MB on both platforms. The crash on Android comes from the size of a single `requestUrl` body, not from memory. The provider therefore splits every transfer internally into HTTP requests under a per-request limit:
   - uploads through upload sessions in parts;
   - downloads through `Range` requests in parts, since `Range` returns `206` on both platforms.

   No ranged-download Capability is added.
2. **Per-request limit.** Every single HTTP request body, upload or download, stays strictly below 20 MB on all platforms. Android crashed downloading 30 MB and uploading 50 MB; iOS passed 50 MB both ways. The default chunk size is left to the spec. The limit is a user setting, in case a device fails even below 20 MB.
3. **Whole files in memory** are safe up to the tested 100 MB on both platforms. The file size ceiling itself is decided in [Synced file scope](11-synced-file-scope.md), built on this figure.
4. **Triggers** ([Sync triggers and lifecycle](13-sync-triggers-and-lifecycle.md)).
   - Return to the app is detected by `visibilitychange` → `visible`, which fired on every return on both platforms. Network back is detected by `online`, which fired on both.
   - `hidden` is not relied on, because Android does not always deliver it. Nothing is attempted "before going to the background": iOS freezes JavaScript there, and Android may restart the app.
   - Periodic polling stays as the fallback.
5. **The Dropbox provider works through `requestUrl` on both mobile platforms as planned:**
   - the PKCE paste-the-code login;
   - escaped non-ASCII `Dropbox-API-Arg` paths;
   - binary upload and download;
   - `Range`;
   - refresh after a second device linked.

   [First provider auth design](14-first-provider-auth-design.md) needs no change.
