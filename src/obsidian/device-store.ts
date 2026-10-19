import type { App } from "obsidian";
import type { Connection, DeviceStore } from "../engine/ports";

/** The localStorage key of this vault's Connection. */
const CONNECTION_KEY = "obsync-connection";

/** The format version of the stored Connection. */
const FORMAT_VERSION = 1;

/**
 * The Device store over Obsidian's per-vault localStorage
 * (`App.loadLocalStorage` / `saveLocalStorage`): on this device only, never
 * in `data.json` or the vault, and separate for each vault. It holds the
 * Connection; where the Sync snapshot and Base live is decided with
 * syncing.
 *
 * The stored record carries a format version. A record that is missing,
 * of another version or malformed reads as no Connection, so the device
 * starts over as a new one (spec, "Further Notes", state format).
 */
export class ObsidianDeviceStore implements DeviceStore {
	/** @param app the Obsidian app whose localStorage holds the state */
	constructor(private readonly app: App) {}

	loadConnection(): Promise<Connection | null> {
		return Promise.resolve(parseConnection(this.app.loadLocalStorage(CONNECTION_KEY)));
	}

	saveConnection(connection: Connection): Promise<void> {
		this.app.saveLocalStorage(CONNECTION_KEY, { formatVersion: FORMAT_VERSION, connection });
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.app.saveLocalStorage(CONNECTION_KEY, null);
		return Promise.resolve();
	}
}

/** The Connection in a stored record, or null if it holds no valid one. */
function parseConnection(stored: unknown): Connection | null {
	if (!isRecord(stored) || stored.formatVersion !== FORMAT_VERSION) return null;
	const { connection } = stored;
	if (!isRecord(connection) || !isRecord(connection.device)) return null;
	const { accountId, remoteRoot, device } = connection;
	if (typeof accountId !== "string" || typeof remoteRoot !== "string") return null;
	if (typeof device.id !== "string" || typeof device.name !== "string") return null;
	return { accountId, remoteRoot, device: { id: device.id, name: device.name } };
}

/** Whether `value` is a non-null object, whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
