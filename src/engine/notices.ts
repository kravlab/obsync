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
 */
export type SyncNotice = {
	readonly kind: "conflictCopyCreated";
	readonly path: VaultPath;
	readonly copyPath: VaultPath;
};
