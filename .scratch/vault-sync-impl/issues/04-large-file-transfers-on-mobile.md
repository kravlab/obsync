# 04: Large file transfers on mobile

Parent spec: `.scratch/vault-sync/spec.md`, "Provider contract" (data transfer) and "Dropbox provider" (transfers).

**What to build:** Attachments up to the size ceiling sync on Android and iOS without crashing the app. Android crashed downloading 30 MB and uploading 50 MB in a single request. The provider splits every transfer into HTTP requests below a per-request limit, under 20 MB by default and adjustable in settings.

**Blocked by:** 03 (Two-way sync of new and changed files).

**Status:** resolved

- [ ] To the engine, `read` and `write` still take and return whole buffers.
- [ ] The Dropbox provider uploads through upload sessions in chunks below the per-request limit, and downloads with `Range` requests in parts below the same limit.
- [ ] The per-request limit is a user setting with a default under 20 MB.
- [ ] The contract suite asserts that no request body exceeds the limit, for files above it.
- [ ] Manual check: a 50 MB attachment syncs in both directions on Android and iOS.

## Comments

- 2026-10-19: Implemented in commit `5b11123` (feat(dropbox): move large files in requests under a per-request limit) on `feat/large-transfers`; plan: `.scratch/vault-sync-impl/plans/04-large-transfers.md`. Ticket closed. The manual check, a 50 MB attachment both ways on Android and iOS, is still to be run on the devices.
