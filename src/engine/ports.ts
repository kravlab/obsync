/**
 * The ports the sync engine reaches the outside world through (spec,
 * "Architecture and modules"). The shell supplies the real adapters, tests
 * supply fakes; the engine never imports Obsidian.
 */
import type { LocalVault } from "./local-vault";
import type { Provider } from "./provider";
import type { SyncStatus } from "./status";

/**
 * This device's authorised link to an account and the Remote chosen there.
 * It exists only on this device.
 */
export interface Connection {
	/** The account at the provider, checked again on every new login. */
	readonly accountId: string;
	/**
	 * The Remote's root at the provider, in the provider's own terms (a path
	 * for some services, an id for others); opaque to the engine.
	 */
	readonly remoteRoot: string;
	/** This device as registered in the Remote's Metadata folder. */
	readonly device: DeviceIdentity;
}

/** How a device is known on a Remote. */
export interface DeviceIdentity {
	/** Random id, created when the device connects to the Remote. */
	readonly id: string;
	/** The name shown to the user, in messages and conflict labels. */
	readonly name: string;
}

/**
 * Opens the provider of a Connection for syncing. Logging in, choosing the
 * Remote and disconnecting go through the connect step (connect-step.ts).
 */
export interface ProviderConnector {
	/** Returns the Provider bound to the Connection's Remote. */
	open(connection: Connection, secret: string): Promise<Provider>;
}

/**
 * Per-device state that never syncs: never in `data.json` or the vault.
 * Grows with the Sync snapshot and Base copies in later tickets.
 */
export interface DeviceStore {
	/** Returns this device's Connection, or null if it has none. */
	loadConnection(): Promise<Connection | null>;
	/** Stores this device's Connection, replacing any earlier one. */
	saveConnection(connection: Connection): Promise<void>;
	/**
	 * Erases everything this device keeps for its Connection: the
	 * Connection itself and, once they exist, the Sync snapshot and Base.
	 */
	clear(): Promise<void>;
}

/** Secrets kept on this device only, over Obsidian's `SecretStorage`. */
export interface SecretStore {
	/** Returns the secret stored under `id`, or null if there is none. */
	getSecret(id: string): string | null;
	/**
	 * Stores `secret` under `id`, a lowercase alphanumeric id with dashes.
	 * An empty secret is not a secret: use `deleteSecret`.
	 */
	setSecret(id: string, secret: string): void;
	/** Removes the secret under `id`; `getSecret` then returns null. */
	deleteSecret(id: string): void;
}

/** The current time. */
export interface Clock {
	/** Milliseconds since the epoch. */
	now(): number;
}

/** Deferred work, such as the pause after edits and polling. */
export interface Scheduler {
	/** Runs `task` once after `delayMs`; the returned function cancels it. */
	schedule(delayMs: number, task: () => void): () => void;
}

/**
 * The engine's calls into the UI. Prompts and notices arrive with the
 * tickets that raise them; prompts will be awaited for the user's answer.
 */
export interface UiPort {
	/** Shows the current sync status. */
	showStatus(status: SyncStatus): void;
}

/** Everything the engine is built from. */
export interface EnginePorts {
	readonly providers: ProviderConnector;
	readonly vault: LocalVault;
	readonly deviceStore: DeviceStore;
	readonly secretStore: SecretStore;
	readonly clock: Clock;
	readonly scheduler: Scheduler;
	readonly ui: UiPort;
}
