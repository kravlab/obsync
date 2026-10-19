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
}

/**
 * Opens the provider of a Connection. The connect step (login, choosing
 * the Remote) and disconnect join this port with the first real provider.
 */
export interface ProviderConnector {
	/** Returns the Provider bound to the Connection's Remote. */
	open(connection: Connection, secret: string): Promise<Provider>;
}

/**
 * Per-device state that never syncs: never in `data.json` or the vault.
 * Grows with the Sync snapshot, Base copies and Device ID in later tickets.
 */
export interface DeviceStore {
	/** Returns this device's Connection, or null if it has none. */
	loadConnection(): Promise<Connection | null>;
}

/** Secrets kept on this device only, over Obsidian's `SecretStorage`. */
export interface SecretStore {
	/** Returns the secret stored under `id`, or null if there is none. */
	getSecret(id: string): string | null;
	/** Stores `secret` under `id`, a lowercase alphanumeric id with dashes. */
	setSecret(id: string, secret: string): void;
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
