# Obsidian platform constraints for sync

Type: research
Status: resolved
Blocked by: none

## Question

What do Obsidian's plugin API and runtime allow and forbid for a sync plugin on desktop, Android and iOS? Find out from primary sources (docs.obsidian.md, the `obsidian` API typings, developer guidelines):

- `requestUrl`: supported methods, binary request/response bodies, streaming or not, practical size limits, timeouts, header restrictions, behaviour on mobile.
- Vault vs `vault.adapter` APIs: which files each can see (is `.obsidian/` visible? hidden files?), binary read/write, stat (mtime/size), rename, and whether writes through the adapter fire vault events.
- Vault events (`create`/`modify`/`delete`/`rename`): when they fire, whether changes made while Obsidian was closed (desktop) are reported on startup, and whether startup indexing emits events.
- Where a plugin can persist its own state (`loadData`/`saveData`, files in the plugin folder) and size/performance considerations on mobile.
- Protocol handlers (`registerObsidianProtocolHandler`): availability on each platform, URL format.
- Mobile app lifecycle: what happens to in-flight work when the app is backgrounded or killed on iOS/Android, and which events a plugin can observe (resume, visibility).
- Community plugin rules that affect sync: network use disclosure, bundling, forbidden APIs.

Deliver findings per platform, flagging anything that rules out a design option.

## Answer

Findings with primary-source citations: branch `research/obsidian-platform-constraints` (local, never merged), file `research/obsidian-platform-constraints.md`.

- **No background sync on mobile.** The plugin API has no pause, resume or background-task hook; `quit` is "not guaranteed to actually run". iOS suspends backgrounded apps and Android may kill them at any time. Every sync step must be safe to cut off at any point.
- **`requestUrl` buffers the whole request and response.** No streaming, timeout or cancellation. On mobile, bodies cross the native bridge as base64, and one user report (unverified) puts the crash point at roughly 20–50 MB. Large transfers must be chunked or resumable. Binary bodies, all methods, custom headers and `throw: false` are supported.
- **The Vault API cannot see hidden paths** (`vault.configDir`, dotfiles). Only `vault.adapter` reaches them, and they produce no vault events, so syncing them means polling.
- **No change history between sessions.** `create` fires for every file at startup (register handlers in `onLayoutReady`). Edits and deletions made while Obsidian was closed are not reported, so the plugin needs its own snapshot (path, mtime, size, hash) to compare against at startup.
- **Plugin state:** `data.json` can be copied to other devices by file-level sync and is rewritten by the settings screen, which makes it a poor place for per-device sync state. Use `app.saveLocalStorage` for per-device state and `SecretStorage` for tokens; `SecretStorage` stays on the device, so each device logs in separately.
- **Community rules:** only `main.js`, `manifest.json` and `styles.css` are installed and no code may be downloaded, so everything is bundled. Client-side telemetry is banned. The README must disclose network use and any account requirement. Using `fetch` raises a linter warning.
- **Protocol handler** `obsidian://<action>?…` works on Windows and macOS, Linux needs manual registration, and the mobile app handles the scheme. Whether plugin-registered actions fire on mobile (including on a cold start) is unverified, so plan an OAuth fallback.
- **Unverified, to check in a prototype:** whether adapter writes fire vault events, whether `visibilitychange` fires on mobile, the largest safe `requestUrl` body per platform, whether `Range` and other headers pass through, redirect handling, whether protocol actions fire on mobile, and storage size limits on mobile.
