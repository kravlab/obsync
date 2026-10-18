# Provider contract

Type: grilling
Status: resolved
Blocked by: 04

## Question

What exactly does the sync engine require from every Provider, and what is optional? Fix the set of operations, the identity a Remote file is addressed by, the metadata each file must report (revision, hash, size, modified time), the optional capabilities and how the engine discovers them, and the error categories a Provider must map its failures into. The contract must fit every surveyed provider without assuming anything only one of them offers; check it against the [Provider capabilities survey](01-provider-capabilities-survey.md). [Remote layout and change detection](04-remote-layout-and-change-detection.md) already requires that every Provider can do a full listing of the Remote, report an opaque per-file revision token, represent folders (emulating them where the service has none), and either skip-and-report or reversibly encode names it cannot mirror. A change feed is an optional capability with a "cursor lost" signal. Still to decide: the rest of the operations, the identity used to address files, the encoding scheme, and how capabilities are discovered.

## Answer

Decided in a grilling session. New glossary terms: Vault path, Remote path, Capability.

1. **Identity.** The engine addresses every Remote entry by its **Remote path**. The provider maps paths to its native ids and caches them. A listing entry may carry an opaque stable id, used only as a hint for rename detection.
2. **Thin, file-level operations:**
   - required: `list` (full listing of the Remote), `read`, `write`, `delete`, `createFolder`;
   - optional Capabilities: `changes` (change feed), file move, folder move, conditional write.

   All sync logic stays in the engine. Chunked or resumable upload and the id cache live inside the provider: the engine only says "write these bytes".
3. **Capabilities** are reported by the provider after it connects to a Remote, and it may probe the server to find them (needed for WebDAV). Anything not reported is treated as absent. A provider never silently ignores a feature it does not support.
4. **Errors.** A provider maps every failure to one of:
   - `auth`: the user must reconnect;
   - `throttled`, with `retryAfter`;
   - `transient`: network or 5xx;
   - `notFound`;
   - `preconditionFailed`: the revision changed, or the file already exists;
   - `cursorLost`;
   - `quotaExceeded`;
   - `tooLarge`;
   - `nameNotRepresentable`;
   - `permanent`.

   The engine decides retries by category. The only exception is a multi-step operation such as a chunked upload, where the provider finishes its own session.
5. **Names.** The provider declares its name rules (forbidden characters, reserved names, case-insensitivity, length limits). The engine applies the Remote's name policy (skip and report, or encode) with one provider-neutral, strictly reversible encoding that touches only characters the provider cannot store; the spec picks the concrete substitutions. Names that differ only by case on a case-insensitive provider are always skipped and reported, even in encode mode.
6. **Conditional writes.** `write` and `delete` take an optional precondition, "only if the revision is X" or "only if absent". The engine may pass it only when the provider reports the conditional-write Capability. A provider must not emulate it with a read before the write. What the engine does without it is decided in [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md).
7. **Move.** File move and folder move are separate optional Capabilities. Without them the engine moves file by file as write-new + delete-old, ordered so that an interrupted move is completed on the next sync. When a rename is propagated as a move is decided in [Deletions and renames](10-deletions-and-renames.md).
8. **Change feed.** `changes(cursor)` returns the current state of each affected Remote path (present with revision X, or deleted) and a new cursor. It never returns raw service events. Entries may repeat, and the last one wins. The provider expands folder renames and deletes to the affected paths itself, or returns `cursorLost`, which makes the engine fall back to a full listing.
9. **Listing and feed entries.**
   - Required: Remote path, kind (file or folder), revision token (for files), size.
   - Optional: stable id, server hash with its algorithm, server mtime (for display only, never for decisions).
10. **Data transfer.** `read` returns and `write` accepts the whole file as one buffer. The provider reports its maximum file size. The size ceiling for syncing is decided in [Synced file scope](11-synced-file-scope.md).
11. **Connecting.** A separate connect step lets the user browse the provider's folders and create one, to pick the Remote root. The provider may fix the root itself, for example Dropbox's App Folder. Every other operation is confined to the chosen root.
12. **The Metadata folder** is read and written with the same operations and appears in listings. The engine excludes it from the vault comparison. Providers know nothing about its purpose.

_Refined by [Mobile runtime checks](17-mobile-runtime-checks.md): the whole-buffer `read`/`write` of point 10 stands, but the provider keeps every single HTTP request body below a per-request limit (under 20 MB by default, user-configurable), using upload sessions and `Range` downloads internally._
