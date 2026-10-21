# Plan: 12 Synced file scope rules

Ticket: `.scratch/vault-sync-impl/issues/12-synced-file-scope-rules.md`
Branch: `feat/file-scope` (new, from `main` at `faa3cf6`, which has ticket 11)
Status: plan and decisions approved 2026-10-21; ignore list uses gitignore syntax (package `ignore`)

## Facts checked

- **Where exclusions live today.** `syncListing` (`src/engine/sync-listing.ts`) narrows both listings. It already leaves out the Metadata folder, the configuration folder and case clashes, while `goneLocally` / `goneRemotely` look at the raw listings. So a path left out there is never taken for a deleted one (`deletions.ts`, `renames.ts` use only these). The new rules slot into the same place.
- **Shared settings already exist.** `RemoteSettings` has `namePolicy` (`skipAndReport` | `encodeReversibly`), `ignoreList` (empty) and `sizeCeilingBytes` (100 MB), read from `settings.json` at the start of every sync. Nothing uses the three yet.
- **The vault port** never lists dot-paths other than the configuration folder (`ObsidianLocalVault.list`, `FakeVault`). The Remote listing can hold them (files put into the App Folder by hand or by another tool), and today they would download.
- **Dropbox name rules are not declared** (`NAME_RULES` in `src/providers/dropbox/provider.ts`: only `caseInsensitive`). A refused name surfaces as `nameNotRepresentable` from `disallowed_name` / `malformed_path`, and stops the whole sync.
- **What Dropbox refuses.** Its API spec (`dropbox-api-spec/files.stone`) lists no characters; `WriteError.disallowed_name` only says "Dropbox will not save the file or folder because of its name". Dropbox's own docs (`help.dropbox.com`, `www.dropbox.com/developers`) are unreachable from this container. The best public source is rclone's Dropbox backend, built from observed behaviour: NUL, `\` and DEL cannot be stored, a name cannot end with a space, and each segment is limited to 255 characters. A third-party FAQ (QNAP) adds names Dropbox will not upload: `desktop.ini`, `thumbs.db`, `.ds_store`, `.dropbox`. These are **not verified on the live service**; see step 1.

## Decisions

### Which paths are left out, on both sides

A path is left out of a sync, with everything inside it, when any rule below holds for it **on either side**. It is then left out on both sides, as case clashes are today, so the other side's version is neither downloaded over it nor uploaded under it. Left-out paths keep their Sync snapshot entry and are never treated as deleted.

1. **Hidden:** any path segment starts with a dot. This covers the Metadata folder. The configuration folder stays excluded by its own rule until ticket 13 adds its exception: `Vault.configDir` is documented as "typically `.obsidian` but it could be different", so a dot is not promised (changed during step 4). Hidden paths are not listed as skipped: the spec says they never sync, and the vault port does not even list them.
2. **Ignored:** the path matches the shared ignore list (syntax: see the open point below).
3. **Too large:** a file larger than the effective ceiling, `min(sizeCeilingBytes, provider.maxFileSize)`, on either side.
4. **Name not representable:** the path cannot be stored under the provider's name rules after the name policy (below).
5. **Case clash:** two vault paths that the provider would store as one (already left out today, now also reported).

Consequences I flag rather than hide:
- A file moved or renamed **into** a left-out path (for example into an ignored folder) is gone from the synced scope at its old path, so the old path is deleted on the other side, through the Deletion guard as usual. Its new path is left out and reported.
- A folder whose only content is left out (an ignored file, a too-large file) keeps that content, so it is never empty and is not deleted on the other side.
- A synced file that grows above the ceiling on one device stops syncing on both sides of that device until it shrinks; other devices go on syncing their own version. It is listed as skipped on the device that has it too large.

### Name policy

- **Provider name rules** (`NameRules`) get one more field, `forbiddenAtEnd`: characters a segment must not end with (Dropbox: space).
- **Dropbox declares:** forbidden `\u0000`, `\`, `\u007F`; forbidden at end: space; reserved `desktop.ini`, `thumbs.db`; `maxSegmentLength` 255; case-insensitive. Step 1 checks these against the service.
- **Skip and report** (default): a path the rules refuse is left out and reported.
- **Encode reversibly:** one provider-neutral table, the substitutions rclone uses:
  - control characters U+0000–U+001F → U+2400–U+241F (`␀`…`␟`), DEL → `␡` (U+2421);
  - a space where it is forbidden (at the end) → `␠` (U+2420);
  - printable ASCII punctuation U+0021–U+007E (not letters or digits) → its fullwidth form U+FF01–U+FF5E (`\` → `＼`, `:` → `：`).

  Only characters the provider declares forbidden are substituted, as the spec asks. To stay strictly reversible without touching other characters, a vault name that already holds a substitute the encoding would produce for this provider is not encoded: it is skipped and reported ("cannot be encoded reversibly"). rclone escapes such names with `‛` instead, which changes a character the provider can store, so I do not follow it there. Reserved names and over-long segments cannot be fixed by substituting characters and are skipped in both modes.
- **Where it applies.** The engine wraps the provider in a name-policy provider (`src/engine/name-policy.ts`) that encodes every vault path it is given and decodes every path it returns (`list`, `changes`, `read`, `write`, `delete`, `createFolder`, `moveFile`, `moveFolder`). The rest of the engine keeps working in vault paths only. Shared settings and device records are read through the provider as it is, since the name policy comes from them. With "skip and report" the wrapper passes paths through unchanged.
- **Stored change-feed state** holds decoded paths. Changing the name policy is ticket 15, which will have to list the Remote in full afterwards; I add that as a comment on ticket 15.

### Provider refusals not covered by the declared rules

A `nameNotRepresentable` or `tooLarge` failure on uploading a new or edited file, or on creating a folder, adds that path to the skipped list and the sync goes on, instead of failing every sync from then on. Elsewhere (merges, Conflict copies, renames) those two failures still stop the sync, since the path was stored once already or its name was checked before.

### The skipped list

- `syncListing` returns `skipped: { path, reason }[]` with the reasons `ignored`, `tooLarge`, `nameNotRepresentable`, `caseClash`, files only, sorted by path. Folders are not listed; the files in them are.
- New `UiPort.showSkipped(files)`, called once per sync after listing, also for a held sync.
- **Shell, until ticket 14's Skipped tab:** the status tooltip and the click notice add "N skipped" and the notice lists each skipped file with its reason, in English and Russian.

### Not in this ticket

- Editing the ignore list, ceiling and name policy in settings (ticket 15). Tests set them through `settings.json`.
- The configuration folder exception (ticket 13).
- Names the **vault** cannot store (a Remote name that the device's file system refuses): unchanged, as today.

## Open point: ignore-list pattern syntax

The spec says "path patterns" and leaves the syntax open. A new dependency needs your choice:

1. **gitignore syntax, package `ignore`** (MIT, no dependencies, 7.0.12, used by ESLint and Prettier for their ignore files). Patterns like `Archive/`, `*.tmp`, `/Templates`, `!keep.md`. Recommended: most users know `.gitignore`, and it covers folders, anchoring and exceptions.
2. **Plain globs, package `picomatch`** (MIT, no dependencies, 4.0.7). Patterns like `Archive/**`, `**/*.tmp`; no exceptions, and every pattern must spell out the folder levels.

Matching is on vault paths, without case on a case-insensitive provider.

## Test seams

1. The name-policy module, pure: each rule (forbidden character, at end, reserved, segment and path length, case), both modes, round trips, a name holding a substitute already.
2. The sync engine through its ports (spec seam 1), with FakeRemote name rules and maximum size and `settings.json` set per test: hidden Remote paths never download; ignored paths on each side; a file above the ceiling on each side and a ceiling above the provider maximum; skip mode and encode mode, two devices round-tripping an encoded name; a case clash reported; an excluded path never deleted on the other side; a move into an ignored folder; a provider refusal on upload skipped and the rest synced; the skipped list on `showSkipped`.
3. Provider contract suite (seam 2): dropped, since step 1 was skipped. A test asserting the declared `NAME_RULES` would only restate the constant; the FakeRemote honours `forbiddenAtEnd` like the other rules.
4. Shell text: skipped count and reasons in EN and RU.

## Steps

- [x] 1. Skipped by choice 2026-10-21: the rules come from rclone and the QNAP FAQ and are marked unverified. Optional live check (you run it, like the `delete_v2` check for ticket 09): upload to Dropbox names with `\`, NUL, DEL, a trailing space, `desktop.ini`, `thumbs.db`, a 256-character segment; record which are refused in `NAME_RULES` and its doc comment. Without it I declare the rules above from rclone and the QNAP FAQ and mark them so.
- [x] 2. `NameRules.forbiddenAtEnd`, the name-policy module and the Dropbox rules (seams 1, 3).
- [x] 3. Ignore matching with the chosen package (seam 1).
- [x] 4. `syncListing`: the five rules and the skipped list (seam 2).
- [x] 5. Engine: the name-policy provider, the ceiling from `maxFileSize`, refusals on upload, `showSkipped` (seam 2).
- [x] 6. Shell: skipped count and list in the status tooltip and notice, EN/RU (seam 4).
- [x] 7. Close ticket 12, comment on ticket 15 (name policy change and the feed state).
- [x] 8. Full test run, typecheck, lint, build with a stand-in key; one code review at the end.

## Review

One code review at the end (2026-10-21). Fixed by choice: refusals are caught only around the entry's own upload (its folders and first write, also for `keepEditedHere` and `uploadEditOver`), never inside merges or Conflict copies; Disconnect empties the skipped list; a case variant above the ceiling no longer clashes with the one under it; the click notice lists the first 20 skipped files and "and N more"; direct tests for `namedProvider`; one sort of the skipped list. Noted on ticket 15: names holding substitute characters on a name-policy change. Left as they are: an entry left out at a path also hides an entry of the other kind there (a file and a folder at one path never synced), and a refused empty folder is retried each sync without a report.
