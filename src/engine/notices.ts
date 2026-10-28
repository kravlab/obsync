import type { FirstSyncTally } from "./first-sync";
import type { VaultPath } from "./local-vault";

/**
 * Something a sync tells the user once, as it happens (spec, "Status,
 * notices, guidance"). It describes the fact; the shell words and shows
 * it. More kinds arrive with the tickets that raise them.
 *
 * - `conflictCopyCreated`: the file at `path` changed on this device and
 *   on the Remote and could not be merged; this device's version is now
 *   kept at `copyPath`, a Conflict copy, and `path` takes the Remote
 *   version unless it was edited again meanwhile.
 * - `restoredAfterDelete`: the file at `path` was deleted on one side and
 *   edited on the other, and the edit won (spec, "Deletions and renames").
 *   `deletedOn` tells where it was deleted: on `thisDevice`, so the edited
 *   Remote version came back into the vault, or on an `otherDevice`, so
 *   this device's edited file was kept and uploaded again. The other
 *   device is not named: without Device journals the writer of a Remote
 *   revision is unknown.
 * - `renamedOnBoth`: the entry this device had renamed to `localPath` was
 *   renamed differently on the Remote; the Remote's name wins, so it is
 *   now at `path` here too.
 * - `renameBeatsDelete`: the entry now at `path` was renamed on one side
 *   and deleted on the other, and the rename won: it is kept under its new
 *   name. `deletedOn` tells where it was deleted, as above.
 * - `firstSyncDone`: a First sync completed, with how many files it
 *   downloaded and uploaded, how many it merged with Conflict blocks left
 *   in them, and how many Conflict copies it made. It stands for every
 *   Conflict copy notice of that sync.
 * - `configurationChanged`: a sync wrote, replaced, trashed or renamed
 *   something in the configuration folder, so Obsidian must restart to
 *   apply the settings that arrived; other plugins are not reloaded. It is
 *   told once per sync, when the first such change is made.
 * - `reconnectNeeded`: the provider refused this device's login, or its
 *   secret is gone, so sync is paused on this device until the user logs
 *   in again. It is told once, when the pause begins.
 * - `namePolicyRefused`: the name policy the user chose was not written,
 *   since the Remote holds entries, at the vault `paths` they stand for,
 *   whose names would become ones the provider cannot store or would be
 *   read as other files; the user renames them first. The other settings
 *   of the change were written.
 */
export type SyncNotice =
	| {
			readonly kind: "conflictCopyCreated";
			readonly path: VaultPath;
			readonly copyPath: VaultPath;
	  }
	| {
			readonly kind: "restoredAfterDelete";
			readonly path: VaultPath;
			readonly deletedOn: "thisDevice" | "otherDevice";
	  }
	| {
			readonly kind: "renamedOnBoth";
			readonly path: VaultPath;
			readonly localPath: VaultPath;
	  }
	| {
			readonly kind: "renameBeatsDelete";
			readonly path: VaultPath;
			readonly deletedOn: "thisDevice" | "otherDevice";
	  }
	| ({ readonly kind: "firstSyncDone" } & Readonly<FirstSyncTally>)
	| { readonly kind: "configurationChanged" }
	| { readonly kind: "reconnectNeeded" }
	| { readonly kind: "namePolicyRefused"; readonly paths: readonly VaultPath[] };
