import type { App } from "obsidian";
import type { VaultPath } from "../engine/local-vault";
import type { Connection, DeviceStore } from "../engine/ports";
import type { SnapshotEntry, SyncSnapshot } from "../engine/sync-snapshot";

/** The localStorage key of this vault's Connection. */
const CONNECTION_KEY = "obsync-connection";

/** The localStorage key naming this vault's snapshot database. */
const SNAPSHOT_DATABASE_KEY = "obsync-snapshot-database";

/** The format version of the stored Connection. */
const CONNECTION_FORMAT_VERSION = 1;

/**
 * The format version of the snapshot, which is also its database's
 * IndexedDB schema version.
 */
const SNAPSHOT_FORMAT_VERSION = 1;

/** The object store holding one snapshot entry per vault path. */
const ENTRIES = "entries";

/**
 * The Device store on this device only, never in `data.json` or the
 * vault, and separate for each vault:
 *
 * - the Connection in Obsidian's per-vault localStorage
 *   (`App.loadLocalStorage` / `saveLocalStorage`);
 * - the Sync snapshot in an IndexedDB database, one record per vault path,
 *   so saving one entry is one write however large the vault is. IndexedDB
 *   is shared by every vault of the app, and Obsidian names no vault id, so
 *   the database gets a random name, kept in the vault's localStorage.
 *
 * Both carry a format version. A Connection that is missing, of another
 * version or malformed reads as none, and a snapshot of another version as
 * empty, so the device starts over (spec, "Further Notes", state format).
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

	async saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry): Promise<void> {
		const name = this.databaseName() ?? this.newDatabase();
		const transaction = (await this.open(name)).transaction(ENTRIES, "readwrite");
		transaction.objectStore(ENTRIES).put(entry, path);
		await completion(transaction);
	}

	async clear(): Promise<void> {
		this.app.saveLocalStorage(CONNECTION_KEY, null);
		const stored = this.storedDatabase();
		this.app.saveLocalStorage(SNAPSHOT_DATABASE_KEY, null);
		if (stored !== null) await this.deleteDatabase(stored.name);
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
	 * another format version that was named before is deleted, unawaited:
	 * nothing reads it any more.
	 */
	private newDatabase(): string {
		const stored = this.storedDatabase();
		if (stored !== null) void this.deleteDatabase(stored.name);
		const name = `obsync-snapshot-${crypto.randomUUID()}`;
		this.app.saveLocalStorage(SNAPSHOT_DATABASE_KEY, { formatVersion: SNAPSHOT_FORMAT_VERSION, name });
		return name;
	}

	/** Opens the database `name`, once, creating its object store on first use. */
	private open(name: string): Promise<IDBDatabase> {
		if (this.database?.name !== name) {
			const opened = new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name, SNAPSHOT_FORMAT_VERSION);
				request.onupgradeneeded = () => request.result.createObjectStore(ENTRIES);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error(`cannot open ${name}`));
			});
			this.database = { name, opened };
		}
		return this.database.opened;
	}

	/** Closes the database `name` if it is open here, then deletes it. */
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
function parseConnection(stored: unknown): Connection | null {
	if (!isRecord(stored) || stored.formatVersion !== CONNECTION_FORMAT_VERSION) return null;
	const { connection } = stored;
	if (!isRecord(connection) || !isRecord(connection.device)) return null;
	const { accountId, remoteRoot, device } = connection;
	if (typeof accountId !== "string" || typeof remoteRoot !== "string") return null;
	if (typeof device.id !== "string" || typeof device.name !== "string") return null;
	return { accountId, remoteRoot, device: { id: device.id, name: device.name } };
}

/** The snapshot entry in a stored record, or null if it holds no valid one. */
function parseEntry(stored: unknown): SnapshotEntry | null {
	if (!isRecord(stored)) return null;
	if (stored.kind === "folder") return { kind: "folder" };
	const { kind, revision, hash } = stored;
	if (kind !== "file" || typeof revision !== "string" || typeof hash !== "string") return null;
	return { kind, revision, hash };
}

/** Whether `value` is a non-null object, whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
