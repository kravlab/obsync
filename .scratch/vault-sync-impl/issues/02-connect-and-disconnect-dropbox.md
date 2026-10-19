# 02: Connect and disconnect Dropbox

Parent spec: `.scratch/vault-sync/spec.md`, sections "Dropbox provider" and "Provider contract" (connect step).

**What to build:** On any device, the user connects the plugin to Dropbox:

1. Approve in the browser and paste the displayed code back (PKCE, no `redirect_uri`).
2. Pick an existing Remote, a subfolder of the app's App Folder, or create a new one named after the vault.
3. The device registers itself with a Device ID and an editable device name.

Disconnecting revokes the login and clears only this device's local state.

**Blocked by:** 01 (Plugin scaffold and test harness).

**Status:** resolved

- [ ] The login works the same on desktop, Android and iOS. A reused or expired code (`invalid_grant`) restarts the login with a clear message.
- [ ] Only the four scopes from the spec are requested. The refresh token is stored in `SecretStorage`, never in `data.json`, the vault or the Remote. Access tokens refresh transparently.
- [ ] The connect step lists App Folder subfolders, marks those holding a Metadata folder as existing Remotes, and can create a new Remote.
- [ ] Creating a Remote writes the Metadata folder with this device's record and the shared Remote settings at their defaults: name policy "skip and report", text-extension list, empty ignore list, 100 MB size ceiling.
- [ ] The `account_id` is recorded with the Connection. A later login to a different account is refused with an explanation.
- [ ] Disconnect calls token revoke, then clears this device's secret, Sync snapshot, Base and Remote binding even if offline. It leaves vault files, the Remote and other devices untouched.
- [ ] The Provider contract suite covers the connect step, code exchange, refresh, account check and revoke, with `requestUrl` mocked.

## Comments

- 2026-10-19: Implemented in commit `01ed227` (feat(dropbox): connect and disconnect a device) on `main`; plan: `.scratch/vault-sync-impl/plans/02-dropbox-connect.md`. Ticket closed.
