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
	  };
