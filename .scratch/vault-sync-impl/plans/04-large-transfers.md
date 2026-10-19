# Plan: 04 Large file transfers on mobile

Ticket: `.scratch/vault-sync-impl/issues/04-large-file-transfers-on-mobile.md`
Branch: `feat/large-transfers`
Status: decisions and test seams approved 2026-10-19

## Decisions

- **Per-request limit setting:** whole MiB (1024 × 1024 bytes, as the size ceiling counts), 1 to 19, default 16. 19 MiB is 19,922,944 bytes, still under 20 MB. A stored or typed value outside that range, or not a whole number, is refused; a missing or unreadable stored value reads as the default. A body of exactly the limit is allowed: no request or response body exceeds it.
- **Storage:** this device's per-vault localStorage (`App.saveLocalStorage`), under its own key with a format version, next to the Connection and not part of it, so a disconnect keeps it. Never in `data.json`.
- **Contract unchanged:** `read` and `write` still take and return whole buffers.
- **Upload:** a file no larger than the limit is one `files/upload`, as now. A larger one is a sequential upload session: `upload_session/start` with the first chunk, `upload_session/append_v2` for the middle ones, `upload_session/finish` with the last chunk and the commit (the same `mode`, `autorename: false`, `strict_conflict: true` as a single upload). Sequential sessions need no 4 MiB multiples (Dropbox API spec, `files.stone` on `main`).
- **Session failures:** the provider finishes its own session (spec, "Provider contract", errors). A `transient` or `throttled` session request is retried up to 3 times, waiting `retryAfterMs` or 1 s, through a `wait` function the shell passes. `incorrect_offset` (a request that arrived although its answer did not) resumes at Dropbox's `correct_offset`. An expired session (`not_found`) is `transient`; `payload_too_large` and `too_large` are `tooLarge`; a finish `path` error maps like an upload's WriteError (a conflict is `preconditionFailed`); anything else is `permanent`.
- **Download:** `files/get_metadata` first gives the file's `rev` and `size`; every request then reads path `rev:<rev>`, so parts never mix two versions. A file no larger than the limit is one plain `files/download`; a larger one is `Range: bytes=start-end` parts no larger than the limit, each answered `206` with exactly the part's length, else `permanent`. No `Range` is sent for an empty file, whose behaviour Dropbox does not document. A path holding no file is `notFound`, a folder `permanent`.
- **Maximum file size:** the upload-session limit 2^41 − 2^22 bytes (`files.stone`), replacing the single-request 150 MB.
- **Wiring:** `createDropboxConnector` takes the transfer options (the limit, read each time a Provider is opened, and `wait`); the connect step keeps its single small upload.
- **Fake Dropbox:** upload sessions with offset checks, `Range` answered `206` with `Content-Range`, `rev:` paths for `download` and `get_metadata` over each file's kept revisions, and a log of responses for the body-size assertions.
- **Review:** one code review at the end (step 6).

## Test seams

1. Provider contract suite, per-request limit: an optional harness opens a Provider with a given limit and reports the largest HTTP request and response body. A file above the limit round-trips intact and lists with its size; absent and revision preconditions still hold on a chunked write; no body exceeds the limit. Dropbox runs it, FakeProvider skips it (no HTTP). Misses the real Dropbox.
2. Dropbox specifics over the fake HTTP service: session request shapes, `Range` headers, parts pinned to one `rev` when the file changes mid-read, retries and `correct_offset` resume, session error mapping, `maxFileSize`, the limit read when a Provider is opened. Misses the real Dropbox.
3. Setting parsing: a stored or typed value to a limit in bytes (default 16 MiB, whole MiB 1–19, anything else refused).

The settings tab, the localStorage adapter and the 50 MB attachment on Android and iOS are checked by hand.

## Steps

- [x] 1. Per-request limit parsing (seam 3).
- [x] 2. Fake Dropbox sessions, `Range`, `rev:` paths; contract harness; chunked upload and ranged download (seam 1).
- [x] 3. Retries, `correct_offset`, `rev` pinning, error mapping, `maxFileSize` (seam 2).
- [x] 4. Shell: localStorage adapter, settings row, EN/RU strings, `wait`, wiring in `main.ts`.
- [x] 5. Full test run, typecheck, lint, build with a stand-in key.
- [x] 6. Code review, commit, ticket closed.

## Review fixes

Chosen by the user on 2026-10-19: every finding of the step 6 review. Each fix is test-first where it changes behaviour.

- [x] P4. `incorrect_offset` resumes are bounded: at most `SESSION_RETRIES` in a row without a request going through, then the write fails `transient`.
- [x] P5. The fake keeps a session's data after a failed `finish` commit, as Dropbox does; a test retries `finish` through `incorrect_offset` and an empty body.
- [x] P3. Only `finish` is checked for `too_many_write_operations`.
- [x] S9, S10, S11. Provider module comment; pending pauses cleared on unload; test imports.
- [x] S2, S8, S5. Doc comments for the limit's constants and fields; `retried` → `withSessionRetries`; one `Wait` type, and the transfers passed as one bundle with a `RequestLimit`.
- [x] S3, S4. Shared `patterned` and `routeError` test helpers and the fake's session length; one mapping each for `payload_too_large` and the write throttle.
- [x] S1, S6, S7. "Per-request limit" in `GLOSSARY.md`, the UI named after it; the stored record format in the Obsidian adapter; the fake without `close` handling.
