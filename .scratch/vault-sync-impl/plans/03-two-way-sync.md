# Plan: 03 Two-way sync of new and changed files

Ticket: `.scratch/vault-sync-impl/issues/03-two-way-sync-of-new-and-changed-files.md`
Branch: `feat/two-way-sync`
Status: approved 2026-10-19

## Decisions

- **Sync snapshot store:** IndexedDB, one record per path, so the per-file update after each file is one write. The database name is random and kept in localStorage next to the Connection, since `obsidian.d.ts` 1.14.4 has no vault id. localStorage would rewrite the whole snapshot after every file and has a small quota shared by all vaults. The Base (ticket 06) goes into the same database. A snapshot with an unknown format version reads as empty.
- **Snapshot entry:** a file records its Remote revision and the SHA-256 of its content (Web Crypto); a folder records only its path. The mtime-and-size shortcut is ticket 05; here every file is hashed.
- **Comparison:**
  - a file present on one side only is copied to the other;
  - a file changed on one side only is copied to the unchanged side;
  - a new Remote revision with the same content only updates the snapshot;
  - every Remote write carries a precondition: `absent` for a new file, the known revision for a changed one;
  - uploads run before downloads;
  - a local file is re-read just before it is overwritten, and left alone if it changed meanwhile.
- **Left alone for now:** a file changed on both sides (merge is ticket 06); deletions (ticket 09); a `preconditionFailed` upload, which the next sync sees as a conflict. A device without a snapshot does a plain union with no preview (preview is ticket 11).
- **Exclusions:** the Metadata folder on the Remote; the configuration folder in the vault, whose categories are off until ticket 13. The Local vault port gains `configDir`. Other dot-paths are ticket 12.
- **No conditional write:** the connect step's `openRoot` returns a full Provider. Connecting checks the Capability before writing the Metadata folder and otherwise ends with `unsupportedProvider` and an EN/RU explanation. Sync makes the same check.
- **Dropbox Provider:** `list` (recursive `list_folder` with paging), `read` (`files/download`), `write` (one request, the code the connect step uses now, shared), `createFolder`, `delete` (`delete_v2` with `parent_rev`; the interface and the contract suite require it). Remote paths are built from each entry's `name`, since `path_display` only guarantees the last component's case. Capabilities: conditional write only. Name rules: case-insensitive, the rest in ticket 12. `maxFileSize` 150 MB, the single-request limit, until ticket 04. A cursor reset maps to `cursorLost`; tests cover all ten error categories.
- **Assumption to confirm:** the `delete_v2` answer to a `parent_rev` mismatch is not in the Dropbox API spec. The fake answers `path_write/conflict/file`, mapped to `preconditionFailed`; ticket 09 confirms it.
- **Statuses:** Syncing…, Synced, Sync failed; Offline and Reconnect needed come with tickets 05 and 14. Connected stays until the first sync of the session. Until ticket 06, a sync ends Synced even when files changed on both sides were left alone.
- **One sync at a time:** a Sync now during a sync joins the running one; the follow-up run is ticket 05.
- **Shell:** Local vault adapter (Vault API for visible paths, the adapter for the configuration folder), the IndexedDB snapshot store, the Dropbox connector, the "Sync now" command and settings button, EN/RU strings. Disconnect erases the snapshot.
- **Review:** one code review at the end (step 8).

## Test seams

1. Sync engine with two devices on one FakeRemote: new and changed files and folders both ways, exclusions, a conflict left alone, a `preconditionFailed` race without loss, a crash mid-sync completed by the next sync, refusal without conditional write, statuses.
2. Provider contract suite against FakeProvider and Dropbox over a fake HTTP service (adding `download`, recursive `list_folder`, `delete_v2`).
3. Dropbox specifics: path case, error mapping to the ten categories, `Dropbox-API-Arg` escaping.

The Obsidian and IndexedDB adapters need the Obsidian runtime or a new dependency, so they are checked by hand on devices.

## Steps

Reordered on 2026-10-19 before step 1, so that every step compiles: changing a port changes all of its implementations in the same step, and `openRoot` can only return a Provider once the Dropbox Provider exists.

- [x] 1. Ports and their implementations: statuses with their EN/RU labels, `configDir`, snapshot operations in the Device store (in memory and over IndexedDB), the provider id shared by connecting and syncing, content hash.
- [x] 2. Engine sync: new files and folders both ways (seam 1).
- [x] 3. Changes both ways, exclusions, conflicts left alone, races, crash (seam 1).
- [x] 4. Fake Dropbox, the Dropbox Provider and its connector (the contract suite opens the Provider through it); contract suite (seams 2, 3).
- [x] 5. `openRoot` → Provider; refusal without conditional write on connect and on sync.
- [x] 6. Shell adapters: Local vault; the Dropbox connector passed to the engine.
- [x] 7. Sync now: command and button, EN/RU strings, engine wiring in `main.ts`.
- [x] 8. Full test run, typecheck, lint, build with a stand-in key, code review, report.

## Review fixes

Chosen by kravlad on 2026-10-19 ("everything, including P5"); assessment in the project's `reviews/ticket-03-review.md`. Each fix is test-first where it changes behaviour.

- [x] P1. Both sides changed to the same content (an edit uploaded just before a crash, or the same edit on two devices) is recorded, not left as changed on both sides.
- [x] P3. The configuration folder is excluded from the Remote listing too.
- [x] P4. A path below a file on the other side is left alone instead of failing the sync.
- [x] P5. Paths match without case on a case-insensitive provider. Each Remote entry is matched to the vault entry with the same folded path (`toLowerCase`, as the FakeRemote folds; Dropbox's own folding is assumed to agree for ordinary names), and an unmatched one takes its parent's vault path plus its own name, so the engine works in vault paths only and the Remote keeps its case. Vault paths that fold to the same key are left alone with everything inside them; reporting them is ticket 12. The FakeRemote files a new entry under its folder's stored case, as the Dropbox Provider lists it.
- [x] Standards: S1 "storage" in `providerUnsupported`; S4 one Dropbox provider id constant; S5 one parser for the stored database record; S6 one "folder and its ancestors" helper; S7 one throttling delay constant and one lookup-error mapping; S8 `saveSnapshotEntry` takes a `VaultPath`; S9 `ensureLocalFolder` → `ensureVaultFolder`; S10 separate format versions for the Connection and the snapshot; S11 a Dropbox file entry without `rev` or `size` fails as `permanent`; S13 the shared `Metadata` type in the connect step and one test helper opening the Dropbox Provider.
