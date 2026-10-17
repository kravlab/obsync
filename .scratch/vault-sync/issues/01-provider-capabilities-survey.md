# Provider capabilities survey

Type: research
Status: resolved
Blocked by: none

## Question

What do Google Drive, Dropbox, OneDrive, WebDAV and S3-compatible storage each offer that a sync engine could build on, and where do they differ? For each one, find out from primary documentation:

- File identity: stable ids, paths, or both; what happens to identity on rename/move.
- Change detection: is there a change feed or cursor (and how long a cursor stays valid), or only listing; cost of listing a large tree.
- Versioning and concurrency: revision ids / ETags, conditional writes (if-match / if-none-match), atomic create, server-side locks.
- Content hashes the server returns (algorithm, available for all files?) and modified-time semantics (settable by the client or not).
- Rename/move and delete semantics (trash, soft delete).
- Limits: file size, upload modes (simple/multipart/resumable), rate limits and error codes.
- Auth model (OAuth flavour, API keys, basic auth) and whether requests work from Obsidian's `requestUrl` on mobile (CORS is not a factor for `requestUrl`, but confirm any header or method restrictions).

Deliver a comparison table plus a short list of capabilities that are *not* universal, since the provider contract cannot assume them.

## Answer

Findings with primary-source citations: branch `research/provider-capabilities` (local, never merged), file `research/provider-capabilities.md`: a comparison table covering 18 dimensions across the five providers, the non-universal capabilities, and the unverified items. The S3 conditional-write and OneDrive delta claims were re-checked against AWS and Microsoft docs.

- **Identity:**
  - Google Drive, Dropbox and OneDrive have ids that survive rename and move.
  - WebDAV identifies files by URL only (stable ids exist only through optional extensions or vendor properties).
  - S3 has only the key. General-purpose buckets have no rename; a rename is a copy followed by a delete, with no atomic update across keys.
- **Change feeds:**
  - Google Drive: page tokens "don't expire".
  - Dropbox: cursors can reset (409), and deletion entries carry a path but no id.
  - OneDrive: tokens can become unusable (410 Gone, then a full resync). The feed shows the latest state per item, may repeat an item, and does not return a renamed folder's descendants, so items must be tracked by id.
  - WebDAV: a feed only where the server implements RFC 6578 `sync-collection`.
  - S3: no client feed, so changes are found by listing.
- **Concurrency:**
  - Dropbox: write only if the given revision matches.
  - OneDrive: `if-match` on upload sessions, delete and move.
  - S3: `If-Match` / `If-None-Match` on PutObject, CompleteMultipartUpload and CopyObject (412 on mismatch, 409 on concurrent conflicts).
  - WebDAV: depends on the server.
  - Google Drive v3: no documented conditional write (unverified, but no v3 equivalent of the v2 etag was found). Read-then-write races are possible, and names are not unique, so two concurrent creates can produce two files with the same name.
- **Hashes:** no common algorithm. Drive returns MD5/SHA-1/SHA-256 for normal files, Dropbox its own block-based SHA-256 and OneDrive QuickXorHash. On S3 the ETag is MD5 only for some objects, plus optional checksums. WebDAV has no standard hash.
- **Modified time:** the client can set it on Drive and OneDrive, but not on standard WebDAV or S3. On Dropbox it is display-only.
- **Uploads:** every provider has a different resumable/multipart scheme with its own chunk rules. WebDAV has none in the standard.
- **`requestUrl` fit:**
  - bodies are strings or ArrayBuffers, and responses are fully buffered;
  - Dropbox needs non-ASCII escaped in its argument header;
  - OneDrive upload URLs must not receive the Authorization header;
  - WebDAV methods (PROPFIND, MOVE) and the full S3 SigV4 header set on mobile are unverified.
- **Not universal**, so the contract cannot assume any of these:
  1. a stable id across rename and move;
  2. a change feed;
  3. a cursor that never expires;
  4. the same feed semantics everywhere;
  5. cheap recursive listing;
  6. compare-and-swap on update;
  7. atomic create-if-absent;
  8. unique, case-preserving names;
  9. a common content hash;
  10. a client-settable modified time;
  11. atomic server-side rename and move;
  12. trash or soft delete;
  13. server-side locks;
  14. one resumable-upload chunk rule;
  15. one rate-limit signal.
