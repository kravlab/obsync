/**
 * The ports the sync engine reaches the outside world through (spec,
 * "Architecture and modules"). The shell supplies the real adapters, tests
 * supply fakes; the engine never imports Obsidian.
 */
import type { LocalVault, VaultPath } from "./local-vault";
import type { Provider } from "./provider";
import type { SyncStatus } from "./status";
import type { SnapshotEntry, SyncSnapshot } from "./sync-snapshot";

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
	/**
	 * Names the provider, as its connect step does; the secret is stored
	 * under `providerSecretId(providerId)`.
	 */
	readonly providerId: string;
	/** Returns the Provider bound to the Connection's Remote. */
	open(connection: Connection, secret: string): Promise<Provider>;
}

/**
 * Per-device state that never syncs: never in `data.json` or the vault.
 * It holds the Connection and the Sync snapshot; Base copies join later.
 */
export interface DeviceStore {
	/** Returns this device's Connection, or null if it has none. */
	loadConnection(): Promise<Connection | null>;
	/** Stores this device's Connection, replacing any earlier one. */
	saveConnection(connection: Connection): Promise<void>;
	/** Returns the Sync snapshot; empty when none was saved or it is unreadable. */
	loadSnapshot(): Promise<SyncSnapshot>;
	/**
	 * Records `entry` for `path`, replacing what was recorded. It is durable
	 * once the returned promise resolves, so a sync cut off after it keeps
	 * the entry.
	 */
	saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry): Promise<void>;
	/**
	 * Erases everything this device keeps for its Connection: the
	 * Connection itself and the Sync snapshot (and the Base, once it exists).
	 */
	clear(): Promise<void>;
}

/**
 * The Secret store id of a provider's login secret, e.g. `obsync-dropbox`:
 * the connect step stores the secret there and syncing reads it back.
 */
export function providerSecretId(providerId: string): string {
	return `obsync-${providerId}`;
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
