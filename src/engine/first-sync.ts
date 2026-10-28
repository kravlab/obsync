/**
 * The First sync (glossary; spec, "First sync"): the sync of a device that
 * has no Sync snapshot for its Remote. It is a union that only adds and
 * merges, never deletes, and nothing changes before the user has seen its
 * preview and started it.
 */
import type { VaultPath } from "./local-vault";
import type { Clock, DeviceStore } from "./ports";
import type { Provider } from "./provider";
import { writeDeviceRecord } from "./remote-metadata";

/**
 * What happens to a file the vault and the Remote both hold with different
 * content: `merged`, `conflictCopy`, `mergedOrConflictCopy` for a JSON
 * file, which merges only when the merge is clean and parses, or
 * `remoteKept` for a configuration file, whose Remote version takes its
 * place while this device's is kept to restore.
 */
export type DifferingOutcome = "merged" | "conflictCopy" | "mergedOrConflictCopy" | "remoteKept";

/**
 * What a First sync would do, file by file, as its preview shows it.
 * Folders are not listed; they follow their files.
 */
export interface FirstSyncPreview {
	/** Files only the Remote has: downloaded. */
	readonly toDownload: readonly VaultPath[];
	/** Files only the vault has: uploaded. */
	readonly toUpload: readonly VaultPath[];
	/** Files both sides hold with the same content: only recorded. */
	readonly identical: readonly VaultPath[];
	/**
	 * Files both sides hold with different content, and what the default
	 * handling does to each: a text file is merged, every difference a
	 * Conflict block; a JSON file is merged if the merge is clean and
	 * parses, else gets a Conflict copy; a configuration file takes the
	 * Remote version, this device's kept to restore; anything else gets a
	 * Conflict copy.
	 */
	readonly differing: readonly { readonly path: VaultPath; readonly outcome: DifferingOutcome }[];
}

/**
 * The user's answer to the preview: start, with differing files `merge`d
 * by the default handling, or with the Remote version kept for every one
 * and the vault's as a Conflict copy (`keepRemote`); null when the preview
 * was closed, which holds sync.
 */
export type FirstSyncAnswer = { readonly differing: "merge" | "keepRemote" } | null;

/** What a completed First sync did, for its summary notice. */
export interface FirstSyncTally {
	/** Files copied into the vault. */
	downloaded: number;
	/** Files copied to the Remote. */
	uploaded: number;
	/** Text files merged with Conflict blocks left in them. */
	conflicted: number;
	/** Conflict copies made. */
	conflictCopies: number;
}

/**
 * Starts a First sync the user started from its preview. A device whose
 * Connection completed a First sync before lost its Sync snapshot, so it
 * registers again under a new Device ID from `newDeviceId`, its old record
 * left to age out. Then its record in the Metadata folder gets the "First
 * sync in progress" mark, timed by `clock`. The new ID is stored before
 * the record is written, so a First sync cut off in between keeps it.
 */
export async function beginFirstSync(
	deviceStore: DeviceStore,
	provider: Provider,
	newDeviceId: () => string,
	clock: Clock,
): Promise<void> {
	const connection = await deviceStore.loadConnection();
	if (connection === null) return;
	let { device } = connection;
	if (connection.firstSyncDone === true) {
		device = { id: newDeviceId(), name: device.name };
		await deviceStore.saveConnection({ ...connection, device, firstSyncDone: false });
	}
	await writeDeviceRecord(provider, device, clock.now());
}

/**
 * After a completed sync with a snapshot: rewrites this device's record
 * when it is out of date, then notes that in the Connection. The first
 * completed sync since a First sync started clears the "First sync in
 * progress" mark, so the First sync is done; one after the user renamed
 * the device writes the new name. A mark a cut-off sync left is cleared by
 * the next one that completes. The Connection is read again after the
 * write, so a rename made meanwhile is kept, for the next completed sync
 * to write.
 */
export async function updateDeviceRecord(deviceStore: DeviceStore, provider: Provider): Promise<void> {
	const connection = await deviceStore.loadConnection();
	if (connection === null || (connection.firstSyncDone === true && connection.deviceRecordOutdated !== true)) return;
	await writeDeviceRecord(provider, connection.device);
	const current = await deviceStore.loadConnection();
	if (current === null) return;
	const renamedMeanwhile = current.device.name !== connection.device.name;
	await deviceStore.saveConnection({ ...current, firstSyncDone: true, deviceRecordOutdated: renamedMeanwhile });
}
