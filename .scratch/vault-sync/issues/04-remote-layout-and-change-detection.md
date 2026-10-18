# Remote layout and change detection

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

How is the vault laid out on the Remote, and how does a device find out what changed there since its last sync? Options include: relying on a provider's change feed where it exists, listing the Remote tree and comparing, or keeping a plugin-owned manifest/index on the Remote that devices update. Decide whether the Remote must stay a plain, human-browsable mirror of the vault, what the plugin is allowed to store there besides the vault files, and how the choice degrades on providers without a change feed (see [Provider capabilities survey](01-provider-capabilities-survey.md)).

## Answer

Decided in a grilling session; the layout and detection choice is recorded in `docs/adr/0002-remote-mirror-with-listing-based-change-detection.md`. New terms (Metadata folder, Sync snapshot) and the sharpened Remote are in `GLOSSARY.md`.

1. **The Remote is a plain mirror.** Vault files sit at the same relative paths and are readable in the provider's own UI. There is no opaque or content-addressed store.
2. **One Remote holds one vault.** It is a root folder the user picks when connecting. The plugin touches nothing outside it, and several vaults sync into separate folders.
3. **Edits made to the Remote outside the plugin** (provider web UI, another sync client) are handled best effort: a change the provider makes visible is treated like any other remote change, with no guarantee beyond that. With Google Drive's `drive.file` scope, files created in the web UI are not visible at all.
4. **Plugin data on the Remote** lives only in the **Metadata folder**: one folder with a dot-prefixed name at the Remote root. Everything else on the Remote is vault files. What the folder contains is left to [Concurrent sync from several devices](06-concurrent-sync-from-several-devices.md) and [Deletions and renames](10-deletions-and-renames.md).
5. **Names a provider cannot mirror faithfully** (forbidden characters, names differing only by case, duplicate names) follow a setting: "skip and report" (the default) or "encode reversibly". The setting belongs to the Remote: it is stored in the Metadata folder and is the same on every device.
6. **Change detection:**
   - **Baseline:** every provider must support a full listing of the Remote, which the device compares with its **Sync snapshot**.
   - **Change feed:** an optional capability that speeds this up.
   - **When to list anyway:** with a feed, a full listing runs only on a device's first sync, after the cursor is lost, or on a manual "full reconcile" command.
   - **No shared manifest:** there is no authoritative manifest or index on the Remote.
7. **"Changed on the Remote" means the provider's opaque per-file revision token differs** from the one in the Sync snapshot (for example Drive `version`, Dropbox `rev`, OneDrive `cTag`, WebDAV `getetag`, S3 `ETag`). A changed token leads to a download and a comparison by the plugin's own content hash, so a false alarm costs a download, never data. Server mtimes and server hashes are not used to decide.
8. **Folders, including empty ones, are entries of the mirror.** Providers without real folders (S3) emulate them.

_Refined by [First sync against an existing Remote](12-first-sync-against-existing-remote.md): when the provider reports a server hash in an algorithm the plugin can compute locally, that hash may decide whether two files are identical, on an exact algorithm match only._
