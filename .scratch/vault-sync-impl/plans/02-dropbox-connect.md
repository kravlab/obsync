# Plan: 02 Connect and disconnect Dropbox

Ticket: `.scratch/vault-sync-impl/issues/02-connect-and-disconnect-dropbox.md`
Branch: `feat/dropbox-connect`
Status: approved 2026-10-19

## Decisions

- **Metadata folder:** `.obsync`. It holds `settings.json` (the shared Remote settings) and `devices/<Device ID>.json` (one device record per device); each file carries `formatVersion: 1`.
- **Shared Remote settings defaults:** name policy "skip and report", empty ignore list, size ceiling 100 MB (100 × 1024 × 1024 bytes), text extensions `md` and `txt`. JSON files such as `canvas` are left out, because the spec gives JSON a Conflict copy instead of a merge.
- **Device ID:** `crypto.randomUUID()`. **Default device name:** the platform (Desktop, Android, iPhone, iPad), editable in the connect window; renaming later is ticket 15.
- **Device store:** `app.saveLocalStorage` (per-vault localStorage, not `data.json`, not the vault). This ticket stores only the Connection, the Device ID and the device name; where the Sync snapshot and Base live is decided in ticket 03.
- **Secret:** `SecretStorage` under the id `obsync-dropbox`. Obsidian 1.14.4 has no way to delete a secret, so disconnect stores an empty string, and an empty string means "no secret". Checked by hand on devices.
- **Connect step port:** a provider-neutral engine port for login (authorize URL, code exchange), listing the App Folder's subfolders marked by whether they hold the Metadata folder, creating a folder, writing the Metadata folder's files, and revoke. `ProviderConnector.open` stays for syncing in ticket 03.
- **Engine:** connect and disconnect are an engine module over the connect step, Device store, Secret store and UI ports. Wiring the whole engine (vault, clock, scheduler) into the shell comes with the first sync in ticket 03.
- **Account check:** the engine refuses a login to a different account while a Connection exists. The UI reaches that login only through Reconnect (ticket 14), so here engine tests cover it.
- **Dropbox provider:** `src/providers/dropbox/`, with no `obsidian` import. It takes a function shaped like `requestUrl`; the shell passes the real one, tests pass a fake Dropbox HTTP service. This ticket builds only what connecting needs: PKCE with the four scopes and no `redirect_uri`, code exchange, `get_current_account`, refresh with a retried request, folder creation, single-request upload of small files, revoke. `list`, `read` and the full contract are ticket 03, chunked transfers ticket 04.
- **Status after connecting:** a new "Connected" state until ticket 03 brings Synced and Syncing.
- **UI:** a settings tab with the state and Connect / Disconnect. The connect window: open the browser, paste the code (on `invalid_grant` a message and a new login), choose a Remote or create one named after the vault, and the device name. All strings in English and Russian.
- **Dropbox app key:** public, with no secret, yet never written in the repository. The build takes it from `OBSYNC_DROPBOX_APP_KEY` (the environment or a git-ignored `.env`) and bundles it into `main.js`; the build fails without it. Tests use a fake key.
- **Review:** one code review at the end (step 7).

## Test seams

1. Sync engine through its ports: connecting, creating a Remote, choosing an existing one, the account check, disconnecting while offline. Misses HTTP.
2. Connect-step contract suite against FakeRemote and against Dropbox over a fake HTTP service: login, a rejected code, refresh, the account id, listing and marking Remotes, revoke. Misses the real Dropbox.
3. Dropbox specifics: authorize URL parameters and `Dropbox-API-Arg` escaping.

UI and login on devices are checked by hand.

## Steps

- [x] 1. Ports: connect step, Device store (save and clear), Secret store (clear), the Connected status.
- [x] 2. Fake connect step on FakeRemote and the connect-step contract suite (seam 2).
- [x] 3. Engine: connecting, Remotes, disconnecting (seam 1).
- [x] 4. Fake Dropbox HTTP service and the Dropbox connect step; the contract suite runs against it (seams 2, 3).
- [x] 5. Shell adapters: SecretStorage, localStorage, `requestUrl`.
- [x] 6. Settings tab and connect window, EN/RU strings, app key.
- [x] 7. Full test run, typecheck, lint, build, code review, report.

## Review fixes (approved 2026-10-19)

Findings are in the project's `reviews/ticket-02-review.md`.

- [x] S9. Glossary names: `startAuthorization`, `AuthorizationAttempt`, `PendingAuthorization`, `AccountAccess`/`access()`, `FakeService`.
- [x] S1. One `statusOf(connection)` shared by the engine and the connection service.
- [x] P6, P7, S5, S6. Typed outcomes for creating a Remote (`nameTaken`, `invalidName` for a name with `/`); the Remote screen reloads its list after a failure; one error-message mapping.
- [x] P1. Disconnect reports whether the revoke went through; the notice tells the user to revoke access in Dropbox when it did not.
- [x] P5. Only a refused code exchange is a rejected code; a refused account lookup is `permanent`.
- [x] P2. Contract test: a login to a second account reports that account's id.
- [x] P3. The access token is refreshed ahead of `expires_in`.
- [x] S2, S3, S4, S7, S8, S11. Missing docs, `activeWindow.open`, dead `isLive`, one JSON parser, single settings row, unexported locals, no provider name in engine comments.
