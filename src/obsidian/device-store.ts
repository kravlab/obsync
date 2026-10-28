import type { App } from "obsidian";
import type { VaultPath } from "../engine/local-vault";
import type { Connection, DeviceStore, RemoteFeed } from "../engine/ports";
import type { RemoteEntry } from "../engine/provider";
import { parseSettings, type RemoteSettings } from "../engine/remote-metadata";
import type { SettingsChange } from "../engine/settings-change";
import type { SnapshotEntry, SyncSnapshot } from "../engine/sync-snapshot";
import { isArrayBuffer } from "./is-array-buffer";
import { isRecord } from "./is-record";

/** The localStorage key of this vault's Connection. */
const CONNECTION_KEY = "obsync-connection";

/** The localStorage key naming this vault's snapshot database. */
const SNAPSHOT_DATABASE_KEY = "obsync-snapshot-database";

/** The localStorage key of the shared Remote settings the last sync read. */
const KNOWN_SETTINGS_KEY = "obsync-known-settings";

/** The localStorage key of the change of the shared Remote settings waiting for a sync. */
const SETTINGS_CHANGE_KEY = "obsync-settings-change";

/** The format version of the stored Connection. */
const CONNECTION_FORMAT_VERSION = 1;

/** The format version of the stored shared settings and settings change. */
const SETTINGS_FORMAT_VERSION = 1;

/** The format version of the snapshot entries; another version reads as an empty snapshot. */
const SNAPSHOT_FORMAT_VERSION = 1;

/**
 * The snapshot database's IndexedDB schema version: 1 held the entries
 * only, 2 added the Bases, 3 the Remote change-feed state, 4 adds the
 * marks (whether the snapshot is complete). An older database is upgraded
 * in place, keeping its existing stores.
 */
const SNAPSHOT_SCHEMA_VERSION = 4;

/** The object store holding one snapshot entry per vault path. */
const ENTRIES = "entries";

/** The object store holding the Base of each text file, by vault path. */
const BASES = "bases";

/** The object store holding the Remote change-feed state. */
const FEED = "feed";

/** The one key in `FEED` holding the current Remote change-feed state. */
const CURRENT_FEED_KEY = "current";

/** The object store holding marks about the snapshot as a whole. */
const MARKS = "marks";

/** The key in `MARKS` present once a First sync completed this snapshot. */
const COMPLETE_KEY = "complete";

/**
 * The Device store on this device only, never in `data.json` or the
 * vault, and separate for each vault:
 *
 * - the Connection in Obsidian's per-vault localStorage
 *   (`App.loadLocalStorage` / `saveLocalStorage`);
 * - the Sync snapshot in an IndexedDB database, one record per vault path,
 *   so saving one entry is one write however large the vault is. IndexedDB
 *   is shared by every vault of the app, and Obsidian names no vault id, so
 *   the database gets a random name, kept in the vault's localStorage;
 * - the Bases in a second object store of that database, written in the
 *   same transaction as their entries and read one at a time when merging;
 * - the Remote change-feed state of the last completed sync (its cursor
 *   and the listing it builds on, server hashes included), in a third;
 * - whether a First sync completed the snapshot, as a mark in that same
 *   database, so it is lost together with the snapshot;
 * - the shared Remote settings the last sync read, and a change of them
 *   waiting for a sync, each in the vault's localStorage under its own key,
 *   so the engine saving one never overwrites the shell saving the other.
 *
 * All carry a format version. A Connection that is missing, of another
 * version or malformed reads as none, and a snapshot of another version as
 * empty, so the device starts over (spec, "Further Notes", state format);
 * shared settings or a change that is not valid read as none.
 */
export class ObsidianDeviceStore implements DeviceStore {
	/** The snapshot database opened so far, if any. */
	private database: { readonly name: string; readonly opened: Promise<IDBDatabase> } | undefined;

	/** @param app the Obsidian app whose localStorage holds the state */
	constructor(private readonly app: App) {}

	loadConnection(): Promise<Connection | null> {
		return Promise.resolve(parseConnection(this.app.loadLocalStorage(CONNECTION_KEY)));
	}

	saveConnection(connection: Connection): Promise<void> {
		this.app.saveLocalStorage(CONNECTION_KEY, { formatVersion: CONNECTION_FORMAT_VERSION, connection });
		return Promise.resolve();
	}

	async loadSnapshot(): Promise<SyncSnapshot> {
		const snapshot = new Map<string, SnapshotEntry>();
		const name = this.databaseName();
		if (name === null) return snapshot;
		const transaction = (await this.open(name)).transaction(ENTRIES, "readonly");
		const request = transaction.objectStore(ENTRIES).openCursor();
		await new Promise<void>((resolve, reject) => {
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor === null) return resolve();
				const entry = parseEntry(cursor.value);
				if (typeof cursor.key === "string" && entry !== null) snapshot.set(cursor.key, entry);
				cursor.continue();
			};
			request.onerror = () => reject(request.error ?? new Error("snapshot read failed"));
		});
		return snapshot;
	}

	async saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry, base: ArrayBuffer | null): Promise<void> {
		const name = this.databaseName() ?? this.newDatabase();
		const transaction = (await this.open(name)).transaction([ENTRIES, BASES], "readwrite");
		transaction.objectStore(ENTRIES).put(entry, path);
		if (base === null) transaction.objectStore(BASES).delete(path);
		else transaction.objectStore(BASES).put(base, path);
		await completion(transaction);
	}

	async removeSnapshotEntry(path: VaultPath): Promise<void> {
		const name = this.databaseName();
		if (name === null) return;
		const transaction = (await this.open(name)).transaction([ENTRIES, BASES], "readwrite");
		transaction.objectStore(ENTRIES).delete(path);
		transaction.objectStore(BASES).delete(path);
		await completion(transaction);
	}

	async moveSnapshotEntry(from: VaultPath, to: VaultPath, entry: SnapshotEntry): Promise<void> {
		const name = this.databaseName() ?? this.newDatabase();
		const transaction = (await this.open(name)).transaction([ENTRIES, BASES], "readwrite");
		const bases = transaction.objectStore(BASES);
		const base = bases.get(from);
		base.onsuccess = () => {
			const found: unknown = base.result;
			if (isArrayBuffer(found)) bases.put(found, to);
			else bases.delete(to);
			bases.delete(from);
		};
		const entries = transaction.objectStore(ENTRIES);
		entries.delete(from);
		entries.put(entry, to);
		await completion(transaction);
	}

	async loadBase(path: VaultPath): Promise<ArrayBuffer | null> {
		const name = this.databaseName();
		if (name === null) return null;
		const request = (await this.open(name)).transaction(BASES, "readonly").objectStore(BASES).get(path);
		const stored = await new Promise<unknown>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("Base read failed"));
		});
		return isArrayBuffer(stored) ? stored : null;
	}

	async hasSnapshot(): Promise<boolean> {
		const name = this.databaseName();
		if (name === null) return false;
		const request = (await this.open(name)).transaction(MARKS, "readonly").objectStore(MARKS).get(COMPLETE_KEY);
		const stored = await new Promise<unknown>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("snapshot mark read failed"));
		});
		return stored === true;
	}

	async markSnapshotComplete(): Promise<void> {
		const name = this.databaseName() ?? this.newDatabase();
		const transaction = (await this.open(name)).transaction(MARKS, "readwrite");
		transaction.objectStore(MARKS).put(true, COMPLETE_KEY);
		await completion(transaction);
	}

	async loadRemoteFeed(): Promise<RemoteFeed | null> {
		const name = this.databaseName();
		if (name === null) return null;
		const request = (await this.open(name)).transaction(FEED, "readonly").objectStore(FEED).get(CURRENT_FEED_KEY);
		const stored = await new Promise<unknown>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("Remote feed read failed"));
		});
		return parseRemoteFeed(stored);
	}

	async saveRemoteFeed(feed: RemoteFeed | null): Promise<void> {
		const name = this.databaseName() ?? this.newDatabase();
		const transaction = (await this.open(name)).transaction(FEED, "readwrite");
		const store = transaction.objectStore(FEED);
		if (feed === null) store.delete(CURRENT_FEED_KEY);
		else store.put(feed, CURRENT_FEED_KEY);
		await completion(transaction);
	}

	loadKnownSettings(): Promise<RemoteSettings | null> {
		const stored = this.loadVersioned(KNOWN_SETTINGS_KEY);
		return Promise.resolve(stored === null ? null : parseSettings(stored.settings));
	}

	saveKnownSettings(settings: RemoteSettings): Promise<void> {
		this.app.saveLocalStorage(KNOWN_SETTINGS_KEY, { formatVersion: SETTINGS_FORMAT_VERSION, settings });
		return Promise.resolve();
	}

	loadSettingsChange(): Promise<SettingsChange | null> {
		const stored = this.loadVersioned(SETTINGS_CHANGE_KEY);
		const base = parseSettings(stored?.base);
		const wanted = parseSettings(stored?.wanted);
		return Promise.resolve(base === null || wanted === null ? null : { base, wanted });
	}

	saveSettingsChange(change: SettingsChange | null): Promise<void> {
		this.app.saveLocalStorage(SETTINGS_CHANGE_KEY, change === null ? null : { formatVersion: SETTINGS_FORMAT_VERSION, ...change });
		return Promise.resolve();
	}

	/** The record stored under `key` when it is of the settings format version, else null. */
	private loadVersioned(key: string): Record<string, unknown> | null {
		const stored: unknown = this.app.loadLocalStorage(key);
		return isRecord(stored) && stored.formatVersion === SETTINGS_FORMAT_VERSION ? stored : null;
	}

	async clear(): Promise<void> {
		this.app.saveLocalStorage(CONNECTION_KEY, null);
		this.app.saveLocalStorage(KNOWN_SETTINGS_KEY, null);
		this.app.saveLocalStorage(SETTINGS_CHANGE_KEY, null);
		const stored = this.storedDatabase();
		this.app.saveLocalStorage(SNAPSHOT_DATABASE_KEY, null);
		// No longer named, the database is erased for this device even if deleting it fails.
		if (stored !== null) await this.discardDatabase(stored.name);
	}

	/** The snapshot database named in localStorage, of any format version, or null. */
	private storedDatabase(): { readonly name: string; readonly formatVersion: unknown } | null {
		const stored: unknown = this.app.loadLocalStorage(SNAPSHOT_DATABASE_KEY);
		if (!isRecord(stored) || typeof stored.name !== "string") return null;
		return { name: stored.name, formatVersion: stored.formatVersion };
	}

	/**
	 * The name of the snapshot database, or null when there is none of
	 * this format version.
	 */
	private databaseName(): string | null {
		const stored = this.storedDatabase();
		return stored?.formatVersion === SNAPSHOT_FORMAT_VERSION ? stored.name : null;
	}

	/**
	 * Names a new, empty snapshot database and records it. A database of
	 * another format version that was named before is discarded, unawaited:
	 * nothing reads it any more.
	 */
	private newDatabase(): string {
		const stored = this.storedDatabase();
		if (stored !== null) void this.discardDatabase(stored.name);
		const name = `obsync-snapshot-${crypto.randomUUID()}`;
		this.app.saveLocalStorage(SNAPSHOT_DATABASE_KEY, { formatVersion: SNAPSHOT_FORMAT_VERSION, name });
		return name;
	}

	/** Closes the snapshot database if it is open; the plugin calls it when it unloads. */
	close(): void {
		const open = this.database;
		this.database = undefined;
		void open?.opened.then((database) => database.close()).catch(() => undefined);
	}

	/**
	 * Opens the database `name`, once, creating the object stores it lacks:
	 * all of them on first use, the newer ones when upgrading from an older
	 * schema version; a database from before the marks store gets the
	 * "complete" mark. An upgrade another connection blocks fails instead of
	 * waiting, and this connection closes when another one needs to upgrade,
	 * so neither side hangs. A blocked open that succeeds after it was given
	 * up is closed at once, so it leaves no connection behind.
	 */
	private open(name: string): Promise<IDBDatabase> {
		if (this.database?.name !== name) {
			const opened = new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name, SNAPSHOT_SCHEMA_VERSION);
				/** Whether the open was given up while blocked: it may still succeed once unblocked, and nothing holds it then. */
				let givenUp = false;
				request.onupgradeneeded = (event) => {
					const database = request.result;
					const marksAdded = !database.objectStoreNames.contains(MARKS);
					for (const store of [ENTRIES, BASES, FEED, MARKS]) {
						if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
					}
					// A snapshot from before First syncs were tracked was made by syncs that completed: no First sync again.
					if (marksAdded && event.oldVersion > 0) request.transaction?.objectStore(MARKS).put(true, COMPLETE_KEY);
				};
				request.onblocked = () => {
					givenUp = true;
					reject(new Error(`upgrading ${name} is blocked by another connection`));
				};
				request.onsuccess = () => {
					const database = request.result;
					if (givenUp) {
						database.close();
						return;
					}
					database.onversionchange = () => {
						database.close();
						if (this.database?.name === name) this.database = undefined;
					};
					resolve(database);
				};
				request.onerror = () => reject(request.error ?? new Error(`cannot open ${name}`));
			});
			this.database = { name, opened };
			// A failed open is not kept: the next sync tries again.
			opened.catch(() => {
				if (this.database?.opened === opened) this.database = undefined;
			});
		}
		return this.database.opened;
	}

	/**
	 * Deletes the database `name`, no longer named in localStorage, so no
	 * store reads it again. A delete that fails, or that another connection
	 * blocks, is reported in the console and leaves it behind unread; it
	 * never rejects, nor waits for the other connection to close.
	 */
	private async discardDatabase(name: string): Promise<void> {
		try {
			await this.deleteDatabase(name);
		} catch (error) {
			console.error("obsync: deleting a snapshot database failed", error);
		}
	}

	/**
	 * Closes the database `name` if it is open here, then deletes it;
	 * rejects when another connection blocks the delete, instead of
	 * waiting for it to close.
	 */
	private async deleteDatabase(name: string): Promise<void> {
		if (this.database?.name === name) {
			const { opened } = this.database;
			this.database = undefined;
			(await opened.catch(() => undefined))?.close();
		}
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error ?? new Error(`cannot delete ${name}`));
			request.onblocked = () => reject(new Error(`deleting ${name} is blocked by another connection`));
		});
	}
}

/** Resolves once `transaction` has committed, so its writes are durable. */
function completion(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("snapshot write failed"));
		transaction.onabort = () => reject(transaction.error ?? new Error("snapshot write aborted"));
	});
}

/** The Connection in a stored record, or null if it holds no valid one. */
export function parseConnection(stored: unknown): Connection | null {
	if (!isRecord(stored) || stored.formatVersion !== CONNECTION_FORMAT_VERSION) return null;
	const { connection } = stored;
	if (!isRecord(connection) || !isRecord(connection.device)) return null;
	const { accountId, remoteRoot, device } = connection;
	if (typeof accountId !== "string" || typeof remoteRoot !== "string") return null;
	if (typeof device.id !== "string" || typeof device.name !== "string") return null;
	// Records from before First sync was tracked have no flag: not done, which costs at most a re-registration less.
	const firstSyncDone = connection.firstSyncDone === true;
	// Only a stored true pauses: anything else syncs, and a refused login pauses again at once.
	const reconnectNeeded = connection.reconnectNeeded === true;
	// Anything but a stored true reads as written: a lost flag only leaves the old name in the record.
	const deviceRecordOutdated = connection.deviceRecordOutdated === true;
	return {
		accountId,
		remoteRoot,
		device: { id: device.id, name: device.name },
		firstSyncDone,
		reconnectNeeded,
		deviceRecordOutdated,
	};
}

/** The snapshot entry in a stored record, or null if it holds no valid one. */
export function parseEntry(stored: unknown): SnapshotEntry | null {
	if (!isRecord(stored)) return null;
	const { kind, revision, hash, size, stableId, stat, conflicted } = stored;
	// A missing or invalid stable id or size only costs a rename hint or a hash.
	const id = typeof stableId === "string" ? { stableId } : {};
	if (kind === "folder") return { kind, ...id };
	if (kind !== "file" || typeof revision !== "string" || typeof hash !== "string") return null;
	const sized = typeof size === "number" ? { size } : {};
	// An entry without a valid stat stays usable: its file is hashed again on the next sync.
	const valid = isRecord(stat) && typeof stat.size === "number" && typeof stat.mtime === "number";
	const statted = valid ? { stat: { size: stat.size as number, mtime: stat.mtime as number } } : {};
	// A lost mark only leaves a file with Conflict blocks off the conflicts list until it is synced again.
	const marked = conflicted === true ? { conflicted: true as const } : {};
	return { kind, revision, hash, ...sized, ...id, ...statted, ...marked };
}

/**
 * The Remote feed state in a stored record, or null if it holds no valid
 * one; without a known name policy its paths cannot be trusted, so it is
 * none and the next sync lists the Remote in full.
 */
export function parseRemoteFeed(stored: unknown): RemoteFeed | null {
	if (!isRecord(stored) || typeof stored.cursor !== "string" || !Array.isArray(stored.entries)) return null;
	const { namePolicy } = stored;
	if (namePolicy !== "skipAndReport" && namePolicy !== "encodeReversibly") return null;
	const entries: RemoteEntry[] = [];
	for (const item of stored.entries) {
		const entry = parseRemoteEntry(item);
		if (entry === null) return null;
		entries.push(entry);
	}
	return { cursor: stored.cursor, namePolicy, entries };
}

/**
 * One listed Remote entry in a stored feed record, or null if invalid. A
 * file keeps its server hash, so a later sync still recognises a file
 * created on both sides by it; a missing or malformed one only costs a
 * download.
 */
function parseRemoteEntry(stored: unknown): RemoteEntry | null {
	if (!isRecord(stored) || typeof stored.path !== "string") return null;
	const id = typeof stored.stableId === "string" ? { stableId: stored.stableId } : {};
	if (stored.kind === "folder") return { kind: "folder", path: stored.path, ...id };
	if (stored.kind === "file" && typeof stored.revision === "string" && typeof stored.size === "number") {
		const { serverHash } = stored;
		const hash =
			isRecord(serverHash) && typeof serverHash.algorithm === "string" && typeof serverHash.value === "string"
				? { serverHash: { algorithm: serverHash.algorithm, value: serverHash.value } }
				: {};
		return { kind: "file", path: stored.path, revision: stored.revision, size: stored.size, ...id, ...hash };
	}
	return null;
}
