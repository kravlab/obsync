/**
 * The ports the sync engine reaches the outside world through (spec,
 * "Architecture and modules"). The shell supplies the real adapters, tests
 * supply fakes; the engine never imports Obsidian.
 */
import type { ConfigurationCategories } from "./configuration";
import type { SyncConflicts } from "./conflicts";
import type { DeletionAnswer, DeletionGuardSettings, DeletionPrompt } from "./deletion-guard";
import type { FirstSyncAnswer, FirstSyncPreview } from "./first-sync";
import type { LocalVault, VaultPath } from "./local-vault";
import type { SyncNotice } from "./notices";
import type { Provider, RemoteEntry } from "./provider";
import type { SyncStatus } from "./status";
import type { SkippedFile } from "./sync-listing";
import type { SyncSchedule } from "./sync-schedule";
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
	/**
	 * Whether this device completed a First sync on this Connection. Done
	 * while the Device store holds no snapshot means the snapshot was lost,
	 * and the next First sync registers the device again (spec, "First
	 * sync"). Absent means not done.
	 */
	readonly firstSyncDone?: boolean;
	/**
	 * Whether sync is paused on this device until the user logs in again:
	 * the provider refused the login (`auth`), or the secret was gone.
	 * Cleared by a login to the same account. Absent means not paused.
	 */
	readonly reconnectNeeded?: boolean;
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
 * The Remote's known listing and the change-feed cursor at that point,
 * kept on this device so the next sync can ask for changes since the
 * cursor instead of listing the whole Remote.
 */
export interface RemoteFeed {
	/** Where the provider's change feed continues from. */
	readonly cursor: string;
	/** Every entry of the Remote as of `cursor`, as a full listing would give them. */
	readonly entries: readonly RemoteEntry[];
}

/**
 * Per-device state that never syncs: never in `data.json` or the vault.
 * It holds the Connection, the Sync snapshot, the Base of each text file,
 * and the Remote change-feed state.
 */
export interface DeviceStore {
	/** Returns this device's Connection, or null if it has none. */
	loadConnection(): Promise<Connection | null>;
	/** Stores this device's Connection, replacing any earlier one. */
	saveConnection(connection: Connection): Promise<void>;
	/** Returns the Sync snapshot; empty when none was saved or it is unreadable. */
	loadSnapshot(): Promise<SyncSnapshot>;
	/**
	 * Records `entry` for `path` with its Base, replacing what was recorded:
	 * `base` is the file's synced bytes for a text file, or null for anything
	 * else, which removes any Base. Entry and Base are written together and
	 * are durable once the returned promise resolves, so a sync cut off
	 * after it keeps both, and one never outlives the other.
	 */
	saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry, base: ArrayBuffer | null): Promise<void>;
	/**
	 * Forgets `path`, gone from both sides: removes its entry and its Base
	 * together, durable once the returned promise resolves. A path not
	 * recorded is left as it is.
	 */
	removeSnapshotEntry(path: VaultPath): Promise<void>;
	/**
	 * Moves what is recorded for `from` to `to` after a rename: records
	 * `entry` for `to` with `from`'s Base, and forgets `from`, in one
	 * step, durable once the returned promise resolves.
	 */
	moveSnapshotEntry(from: VaultPath, to: VaultPath, entry: SnapshotEntry): Promise<void>;
	/** Returns the Base recorded for `path`, or null if there is none. */
	loadBase(path: VaultPath): Promise<ArrayBuffer | null>;
	/**
	 * Whether this device has a Sync snapshot: one a First sync completed
	 * (`markSnapshotComplete`), however few entries it holds. One lost,
	 * unreadable or of another format version is none.
	 */
	hasSnapshot(): Promise<boolean>;
	/** Records that a First sync completed the snapshot, durable once the returned promise resolves. */
	markSnapshotComplete(): Promise<void>;
	/**
	 * Returns the Remote feed state from the last completed sync, or null
	 * when none was saved or it is unreadable.
	 */
	loadRemoteFeed(): Promise<RemoteFeed | null>;
	/**
	 * Stores the Remote feed state from a completed sync, or removes it
	 * when `feed` is null.
	 */
	saveRemoteFeed(feed: RemoteFeed | null): Promise<void>;
	/**
	 * Erases everything this device keeps for its Connection: the
	 * Connection itself, the Sync snapshot, every Base, and the Remote feed
	 * state.
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

/**
 * A local version of a configuration file that the Remote's version
 * replaced in a configuration conflict, kept so the user can restore it
 * (spec, "Synced file scope", configuration folder).
 */
export interface KeptConfiguration {
	/** Names this kept version among all of them. */
	readonly id: string;
	/** The configuration file it is a version of, as a vault path. */
	readonly path: VaultPath;
	/** When it was kept, in ms since the epoch by the engine's Clock. */
	readonly keptAt: number;
}

/**
 * The local versions kept on configuration conflicts, on this device only
 * and never synced: in the sync plugin's own folder. Every conflict keeps
 * one, so a second conflict on a file does not replace the first.
 */
export interface ConfigurationConflictStore {
	/** Keeps `data`, this device's version of `path`, as of `keptAt`; durable once the returned promise resolves. */
	keep(path: VaultPath, data: ArrayBuffer, keptAt: number): Promise<KeptConfiguration>;
	/** Every kept version, newest first. */
	list(): Promise<readonly KeptConfiguration[]>;
	/** The bytes of the kept version `id`, or null when none is kept under it. */
	read(id: string): Promise<ArrayBuffer | null>;
	/** Forgets the kept version `id`; an id not kept changes nothing. */
	remove(id: string): Promise<void>;
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
 * The engine's calls into the UI. Prompts are awaited for the user's
 * answer; more arrive with the tickets that raise them.
 */
export interface UiPort {
	/** Shows the current sync status. */
	showStatus(status: SyncStatus): void;
	/** Tells the user `notice` once, without waiting for an answer. */
	showNotice(notice: SyncNotice): void;
	/**
	 * Shows the files the last sync left out for a reason the user is told
	 * (sync-listing.ts), each with its reason, ordered by path; it replaces
	 * the list shown before.
	 */
	showSkipped(files: readonly SkippedFile[]): void;
	/**
	 * Shows what is left in conflict on this device: files with Conflict
	 * blocks, Conflict copies, and the local versions kept on configuration
	 * conflicts, which the user can restore; it replaces the list shown
	 * before.
	 */
	showConflicts(conflicts: SyncConflicts): void;
	/**
	 * Asks the user what to do about the deletions the Deletion guard
	 * stopped, with the list to review, and resolves with the answer; null
	 * when the prompt was closed without one.
	 */
	askDeletions(prompt: DeletionPrompt): Promise<DeletionAnswer>;
	/**
	 * Shows what a First sync would do and resolves when the user starts it,
	 * with how to handle differing files, or null when the preview was
	 * closed without starting.
	 */
	askFirstSync(preview: FirstSyncPreview): Promise<FirstSyncAnswer>;
}

/** Everything the engine is built from. */
export interface EnginePorts {
	readonly providers: ProviderConnector;
	readonly vault: LocalVault;
	readonly deviceStore: DeviceStore;
	readonly secretStore: SecretStore;
	readonly configurationConflicts: ConfigurationConflictStore;
	readonly clock: Clock;
	readonly scheduler: Scheduler;
	readonly ui: UiPort;
	/** This device's current schedule settings, read each time they are needed. */
	readonly schedule: () => SyncSchedule;
	/** This device's current Deletion guard thresholds, read at the start of each sync. */
	readonly deletionGuard: () => DeletionGuardSettings;
	/** The configuration categories this device syncs now, read at the start of each sync. */
	readonly configurationCategories: () => ConfigurationCategories;
	/** This plugin's own folder in the configuration folder (`manifest.dir`), which never syncs. */
	readonly pluginDir: VaultPath;
	/** This plugin's id (`manifest.id`): `plugins/<id>` in the configuration folder never syncs either. */
	readonly pluginId: string;
	/** Returns a new random Device ID, for registering again after the Sync snapshot was lost. */
	readonly newDeviceId: () => string;
}
