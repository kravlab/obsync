/**
 * The Connection epoch (spec of the review fixes, items 4 and 5): a
 * counter the plugin process keeps, which Disconnect advances. What
 * belongs to one Connection is taken under the epoch it started in, so
 * once the user disconnects, it no longer counts: a sync running across
 * Disconnect writes nothing more to this device's state, and a hold set
 * before it does not hold the next Connection. It lives in memory only,
 * since Disconnect and the syncs it outdates run in one process.
 */
import type { DeviceStore } from "./ports";

/** The Connection epoch both the connection service and the sync engine read. */
export interface ConnectionEpoch {
	/** The epoch now. */
	current(): number;
	/** Whether `taken`, an epoch read before, is still the epoch now. */
	isCurrent(taken: number): boolean;
	/** Starts a new epoch; Disconnect calls it before clearing this device's state. */
	advance(): void;
}

/** A new Connection epoch, starting at 0. */
export function createConnectionEpoch(): ConnectionEpoch {
	let epoch = 0;
	return {
		current: () => epoch,
		isCurrent: (taken) => taken === epoch,
		advance: () => {
			epoch += 1;
		},
	};
}

/**
 * Thrown by a device store bound to an epoch that has moved on: the
 * Connection the write belonged to was disconnected, so the work writing
 * it ends without a word.
 */
export class ConnectionChanged extends Error {
	constructor() {
		super("the Connection changed: this device was disconnected");
		this.name = "ConnectionChanged";
	}
}

/**
 * `store` for work started in the epoch `taken` of `epoch`: reads pass
 * through, and every write is refused with `ConnectionChanged`, changing
 * nothing, once the epoch is no longer `taken`.
 */
export function boundToEpoch(store: DeviceStore, epoch: ConnectionEpoch, taken: number): DeviceStore {
	/** Runs `write` while the epoch is still `taken`; refuses it otherwise. */
	function guarded<T>(write: () => Promise<T>): Promise<T> {
		return epoch.isCurrent(taken) ? write() : Promise.reject(new ConnectionChanged());
	}
	return {
		loadConnection: () => store.loadConnection(),
		loadSnapshot: () => store.loadSnapshot(),
		loadBase: (path) => store.loadBase(path),
		hasSnapshot: () => store.hasSnapshot(),
		loadRemoteFeed: () => store.loadRemoteFeed(),
		saveConnection: (connection) => guarded(() => store.saveConnection(connection)),
		saveSnapshotEntry: (path, entry, base) => guarded(() => store.saveSnapshotEntry(path, entry, base)),
		removeSnapshotEntry: (path) => guarded(() => store.removeSnapshotEntry(path)),
		moveSnapshotEntry: (from, to, entry) => guarded(() => store.moveSnapshotEntry(from, to, entry)),
		markSnapshotComplete: () => guarded(() => store.markSnapshotComplete()),
		saveRemoteFeed: (feed) => guarded(() => store.saveRemoteFeed(feed)),
		clear: () => guarded(() => store.clear()),
	};
}
