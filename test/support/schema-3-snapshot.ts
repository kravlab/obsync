/**
 * A device's state as the build before First sync left it (snapshot
 * database at IndexedDB schema version 3), for the check that such a
 * database opens as a complete snapshot. That build kept the stores
 * `entries`, `bases` and `feed`, and no `marks`; its snapshot entries had
 * no `conflicted` mark and its feed entries no server hash; its Connection
 * had no `firstSyncDone` or `reconnectNeeded`. The fixture is made from
 * the state the current build left after a real sync, with those parts
 * taken out.
 */

/** The vault's localStorage as Obsidian's App gives it, as far as the fixture uses it. */
interface VaultStorage {
	loadLocalStorage(key: string): unknown;
	saveLocalStorage(key: string, value: unknown): void;
}

/** The localStorage key naming the snapshot database, the same in both builds. */
const SNAPSHOT_DATABASE_KEY = "obsync-snapshot-database";

/** The localStorage key of the Connection, the same in both builds. */
const CONNECTION_KEY = "obsync-connection";

/** The stores a schema 3 snapshot database holds. */
const SCHEMA_3_STORES = ["entries", "bases", "feed"] as const;

/** A store's records, each key with its value. */
type Records = readonly { readonly key: IDBValidKey; readonly value: unknown }[];

/** Resolves with what `request` gives, or fails with its error. */
export function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
	});
}

/** Whether `value` is a non-null object, whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** `value` without the fields `names`, if it is a record; anything else as it is. */
function without(value: unknown, names: readonly string[]): unknown {
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.entries(value).filter(([name]) => !names.includes(name)));
}

/** `value`, a stored record of `store`, as the schema 3 build wrote it. */
function asSchema3(store: (typeof SCHEMA_3_STORES)[number], value: unknown): unknown {
	if (store === "entries") return without(value, ["conflicted"]);
	if (store === "feed" && isRecord(value) && Array.isArray(value.entries)) {
		return { ...value, entries: value.entries.map((entry: unknown) => without(entry, ["serverHash"])) };
	}
	return value;
}

/**
 * Turns the state the current build left in `app` after a sync into the
 * state the build before First sync would have left for the same sync:
 * the snapshot database named in the vault's localStorage holds its
 * `entries`, `bases` and `feed` records at schema 3, as that build wrote
 * them, and nothing else, and the Connection loses the fields that build
 * did not know. No connection may hold the database open.
 */
export async function downgradeToSchema3(app: VaultStorage): Promise<void> {
	const named = app.loadLocalStorage(SNAPSHOT_DATABASE_KEY);
	if (!isRecord(named) || typeof named.name !== "string") throw new Error("no snapshot database named");
	await downgradeDatabase(named.name);
	const stored = app.loadLocalStorage(CONNECTION_KEY);
	if (isRecord(stored)) {
		app.saveLocalStorage(CONNECTION_KEY, { ...stored, connection: without(stored.connection, ["firstSyncDone", "reconnectNeeded"]) });
	}
}

/** Rewrites the snapshot database `name` at schema 3, as `downgradeToSchema3` says; fails for a database without the three stores. */
async function downgradeDatabase(name: string): Promise<void> {
	const current = await done(indexedDB.open(name));
	const missing = SCHEMA_3_STORES.filter((store) => !current.objectStoreNames.contains(store));
	if (missing.length > 0) {
		current.close();
		throw new Error(`${name} is not a snapshot database: it has no ${missing.join(", ")}`);
	}
	const records = new Map<string, Records>();
	for (const store of SCHEMA_3_STORES) {
		const objects = current.transaction(store, "readonly").objectStore(store);
		const [keys, values]: [IDBValidKey[], unknown[]] = await Promise.all([done(objects.getAllKeys()), done(objects.getAll())]);
		records.set(
			store,
			keys.map((key, index) => ({ key, value: asSchema3(store, values[index]) })),
		);
	}
	current.close();
	const deleting = indexedDB.deleteDatabase(name);
	await new Promise<void>((resolve, reject) => {
		deleting.onsuccess = () => resolve();
		deleting.onerror = () => reject(deleting.error ?? new Error(`cannot delete ${name}`));
		deleting.onblocked = () => reject(new Error(`deleting ${name} is blocked by another connection`));
	});
	const opening = indexedDB.open(name, 3);
	opening.onupgradeneeded = () => {
		for (const store of SCHEMA_3_STORES) opening.result.createObjectStore(store);
	};
	const old = await done(opening);
	const transaction = old.transaction([...SCHEMA_3_STORES], "readwrite");
	for (const [store, stored] of records) {
		for (const { key, value } of stored) transaction.objectStore(store).put(value, key);
	}
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error(`cannot write ${name}`));
	});
	old.close();
}
