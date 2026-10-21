import {
	providerSecretId,
	type ConfigurationConflictStore,
	type Connection,
	type DeviceStore,
	type KeptConfiguration,
	type EnginePorts,
	type ProviderConnector,
	type RemoteFeed,
	type SecretStore,
} from "../../src/engine/ports";
import { DEFAULT_CONFIGURATION_CATEGORIES, type ConfigurationCategories } from "../../src/engine/configuration";
import type { SyncConflicts } from "../../src/engine/conflicts";
import type { ActivityEvent, ActivityUi } from "../../src/engine/activity-log";
import { DEFAULT_DELETION_GUARD, type DeletionAnswer, type DeletionGuardSettings, type DeletionPrompt } from "../../src/engine/deletion-guard";
import type { FirstSyncAnswer, FirstSyncPreview } from "../../src/engine/first-sync";
import type { LocalVault, VaultPath } from "../../src/engine/local-vault";
import type { SyncNotice } from "../../src/engine/notices";
import {
	DEFAULT_REMOTE_SETTINGS,
	METADATA_FOLDER,
	SETTINGS_PATH,
	encodeSettings,
} from "../../src/engine/remote-metadata";
import type { Provider } from "../../src/engine/provider";
import type { SyncStatus } from "../../src/engine/status";
import type { SkippedFile } from "../../src/engine/sync-listing";
import { DEFAULT_SYNC_SCHEDULE, type SyncSchedule } from "../../src/engine/sync-schedule";
import type { SnapshotEntry, SyncSnapshot } from "../../src/engine/sync-snapshot";
import type { FakeProvider } from "./fake-provider";
import type { FakeRemote } from "./fake-remote";
import { FakeVault } from "./fake-vault";
import { CrashPoints } from "./crash-points";
import { ManualClock } from "./manual-clock";
import { ManualScheduler } from "./manual-scheduler";

/** The provider id of a test device's ProviderConnector. */
export const TEST_PROVIDER_ID = "fake-service";

/** A Device store in memory, holding at most one Connection, its Sync snapshot and Bases. */
export class InMemoryDeviceStore implements DeviceStore {
	/** The Sync snapshot, by vault path. */
	readonly snapshot = new Map<VaultPath, SnapshotEntry>();
	/** The Base of each text file, by vault path. */
	readonly bases = new Map<VaultPath, ArrayBuffer>();
	/** The Remote change-feed state from the last completed sync, if any. */
	remoteFeed: RemoteFeed | null = null;
	/** Whether a First sync completed the snapshot. */
	snapshotComplete = false;

	/** @param connection this device's Connection, or null for none */
	constructor(public connection: Connection | null = null) {}

	loadConnection(): Promise<Connection | null> {
		return Promise.resolve(this.connection);
	}

	saveConnection(connection: Connection): Promise<void> {
		this.connection = connection;
		return Promise.resolve();
	}

	loadSnapshot(): Promise<SyncSnapshot> {
		return Promise.resolve(new Map(this.snapshot));
	}

	saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry, base: ArrayBuffer | null): Promise<void> {
		this.snapshot.set(path, entry);
		if (base === null) this.bases.delete(path);
		else this.bases.set(path, base.slice(0));
		return Promise.resolve();
	}

	removeSnapshotEntry(path: VaultPath): Promise<void> {
		this.snapshot.delete(path);
		this.bases.delete(path);
		return Promise.resolve();
	}

	moveSnapshotEntry(from: VaultPath, to: VaultPath, entry: SnapshotEntry): Promise<void> {
		const base = this.bases.get(from);
		this.snapshot.delete(from);
		this.bases.delete(from);
		this.snapshot.set(to, entry);
		if (base === undefined) this.bases.delete(to);
		else this.bases.set(to, base);
		return Promise.resolve();
	}

	loadBase(path: VaultPath): Promise<ArrayBuffer | null> {
		return Promise.resolve(this.bases.get(path)?.slice(0) ?? null);
	}

	/**
	 * Loses the Sync snapshot, its Bases and the Remote feed state, as
	 * cleared site data or an unknown format version would, keeping the
	 * Connection.
	 */
	loseSnapshot(): void {
		this.snapshot.clear();
		this.bases.clear();
		this.remoteFeed = null;
		this.snapshotComplete = false;
	}

	hasSnapshot(): Promise<boolean> {
		return Promise.resolve(this.snapshotComplete);
	}

	markSnapshotComplete(): Promise<void> {
		this.snapshotComplete = true;
		return Promise.resolve();
	}

	loadRemoteFeed(): Promise<RemoteFeed | null> {
		return Promise.resolve(
			this.remoteFeed === null
				? null
				: { cursor: this.remoteFeed.cursor, entries: [...this.remoteFeed.entries] },
		);
	}

	saveRemoteFeed(feed: RemoteFeed | null): Promise<void> {
		this.remoteFeed = feed === null ? null : { cursor: feed.cursor, entries: [...feed.entries] };
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.connection = null;
		this.snapshot.clear();
		this.bases.clear();
		this.remoteFeed = null;
		this.snapshotComplete = false;
		return Promise.resolve();
	}
}

/** A configuration conflict store in memory; ids count up from `kept-1`. */
export class InMemoryConfigurationConflicts implements ConfigurationConflictStore {
	/** Every kept version with its bytes, oldest first. */
	private readonly kept: { readonly version: KeptConfiguration; readonly data: ArrayBuffer }[] = [];
	private nextId = 1;

	keep(path: VaultPath, data: ArrayBuffer, keptAt: number): Promise<KeptConfiguration> {
		const version = { id: `kept-${this.nextId}`, path, keptAt };
		this.nextId += 1;
		this.kept.push({ version, data: data.slice(0) });
		return Promise.resolve(version);
	}

	/** Newest first: by time kept, the later kept first among the same time. */
	list(): Promise<readonly KeptConfiguration[]> {
		return Promise.resolve(this.kept.map(({ version }) => version).reverse().sort((a, b) => b.keptAt - a.keptAt));
	}

	read(id: string): Promise<ArrayBuffer | null> {
		return Promise.resolve(this.kept.find(({ version }) => version.id === id)?.data.slice(0) ?? null);
	}

	remove(id: string): Promise<void> {
		const index = this.kept.findIndex(({ version }) => version.id === id);
		if (index !== -1) this.kept.splice(index, 1);
		return Promise.resolve();
	}
}

/** A Secret store in memory. */
export class InMemorySecretStore implements SecretStore {
	private readonly secrets = new Map<string, string>();

	getSecret(id: string): string | null {
		return this.secrets.get(id) ?? null;
	}

	setSecret(id: string, secret: string): void {
		this.secrets.set(id, secret);
	}

	deleteSecret(id: string): void {
		this.secrets.delete(id);
	}
}

/**
 * A UI port that records what the engine showed, and answers its prompts
 * as scripted; it records the activity log's events too.
 */
export class RecordingUi implements ActivityUi {
	/** Every status shown, oldest first. */
	readonly statuses: SyncStatus[] = [];
	/** Every notice shown, oldest first. */
	readonly notices: SyncNotice[] = [];
	/** Every Deletion guard prompt asked, oldest first. */
	readonly prompts: DeletionPrompt[] = [];
	/** The answers to give the next Deletion guard prompts, in order; a prompt with none left fails the sync. */
	readonly answers: DeletionAnswer[] = [];
	/** Runs when the next prompt is asked, before it is answered, e.g. the user asking for a sync meanwhile. */
	onAsk: (() => void) | undefined;
	/** Every First sync preview shown, oldest first. */
	readonly previews: FirstSyncPreview[] = [];
	/** The answers to give the next previews, in order; with none left, the sync starts with differing files merged. */
	readonly firstSyncAnswers: FirstSyncAnswer[] = [];
	/** Every skipped-files list shown, oldest first. */
	readonly skippedLists: (readonly SkippedFile[])[] = [];
	/** Every conflicts list shown, oldest first. */
	readonly conflictLists: SyncConflicts[] = [];
	/** Every activity log shown, oldest first. */
	readonly activityLogs: (readonly ActivityEvent[])[] = [];

	/** The status shown last, or undefined if none was. */
	get lastStatus(): SyncStatus | undefined {
		return this.statuses[this.statuses.length - 1];
	}

	showStatus(status: SyncStatus): void {
		this.statuses.push(status);
	}

	/** The skipped-files list shown last, or undefined if none was. */
	get lastSkipped(): readonly SkippedFile[] | undefined {
		return this.skippedLists[this.skippedLists.length - 1];
	}

	/** Records `files` instead of showing them. */
	showSkipped(files: readonly SkippedFile[]): void {
		this.skippedLists.push(files);
	}

	/** The conflicts list shown last, or undefined if none was. */
	get lastConflicts(): SyncConflicts | undefined {
		return this.conflictLists[this.conflictLists.length - 1];
	}

	/** Records `conflicts` instead of showing them. */
	showConflicts(conflicts: SyncConflicts): void {
		this.conflictLists.push(conflicts);
	}

	/** Records `notice` instead of showing it. */
	showNotice(notice: SyncNotice): void {
		this.notices.push(notice);
	}

	/** The activity log shown last, or undefined if none was. */
	get lastActivity(): readonly ActivityEvent[] | undefined {
		return this.activityLogs[this.activityLogs.length - 1];
	}

	/** Records `events` instead of showing them. */
	showActivity(events: readonly ActivityEvent[]): void {
		this.activityLogs.push(events);
	}

	/** Records `prompt` and gives the next scripted answer; an unscripted prompt is a test failure. */
	askDeletions(prompt: DeletionPrompt): Promise<DeletionAnswer> {
		this.prompts.push(prompt);
		this.onAsk?.();
		if (this.answers.length === 0) return Promise.reject(new Error("unexpected Deletion guard prompt"));
		return Promise.resolve(this.answers.shift() ?? null);
	}

	/** Records `preview` and gives the next scripted answer, or starts with differing files merged. */
	askFirstSync(preview: FirstSyncPreview): Promise<FirstSyncAnswer> {
		this.previews.push(preview);
		const answer = this.firstSyncAnswers.length > 0 ? this.firstSyncAnswers.shift() : { differing: "merge" as const };
		return Promise.resolve(answer ?? null);
	}
}

/** One simulated device: its fakes and the ports built from them. */
export interface TestDevice {
	/**
	 * Where the device can crash: its provider's operations and the engine's
	 * vault writes and Device store saves, counted together.
	 */
	readonly crash: CrashPoints;
	/** The device's one Provider on the Remote, which tests steer (faults, crashes). */
	readonly provider: FakeProvider;
	readonly vault: FakeVault;
	readonly deviceStore: InMemoryDeviceStore;
	readonly secretStore: InMemorySecretStore;
	readonly configurationConflicts: InMemoryConfigurationConflicts;
	readonly clock: ManualClock;
	readonly scheduler: ManualScheduler;
	readonly ui: RecordingUi;
	/** The device's schedule settings; tests may replace it at any time. */
	schedule: SyncSchedule;
	/** The device's Deletion guard thresholds; tests may replace them at any time. */
	deletionGuard: DeletionGuardSettings;
	/** The configuration categories the device syncs, none at first; tests may replace them at any time. */
	configurationCategories: ConfigurationCategories;
	/** This plugin's own folder in the device's configuration folder. */
	readonly pluginDir: string;
	readonly ports: EnginePorts;
}

/** How a test device is set up. */
export interface TestDeviceOptions {
	/** The vault's configuration folder; FakeVault's default when absent. */
	readonly configDir?: string;
}

/**
 * Builds a device whose provider opens on `remote`, always as the same
 * FakeProvider, so faults a test injects reach the engine. Several devices
 * built on one FakeRemote sync the same Remote. The device has no
 * Connection; `connectTestDevice` gives it one. This plugin's folder is
 * `plugins/obsync` in the configuration folder, as Obsidian installs it.
 */
export function createTestDevice(remote: FakeRemote, options: TestDeviceOptions = {}): TestDevice {
	const clock = new ManualClock();
	const vault = new FakeVault({ clock, ...(options.configDir === undefined ? {} : { configDir: options.configDir }) });
	const pluginId = "obsync";
	const pluginDir = `${vault.configDir}/plugins/${pluginId}`;
	const deviceStore = new InMemoryDeviceStore();
	const secretStore = new InMemorySecretStore();
	const configurationConflicts = new InMemoryConfigurationConflicts();
	const scheduler = new ManualScheduler(clock);
	const ui = new RecordingUi();
	const crash = new CrashPoints();
	const provider = remote.openProvider(crash);
	const providers: ProviderConnector = {
		providerId: TEST_PROVIDER_ID,
		open: (): Promise<Provider> => Promise.resolve(provider),
	};
	const device: TestDevice = {
		crash,
		provider,
		vault,
		deviceStore,
		secretStore,
		configurationConflicts,
		clock,
		scheduler,
		ui,
		schedule: DEFAULT_SYNC_SCHEDULE,
		deletionGuard: DEFAULT_DELETION_GUARD,
		configurationCategories: DEFAULT_CONFIGURATION_CATEGORIES,
		pluginDir,
		ports: {
			providers,
			vault: crashingVault(vault, crash),
			deviceStore: crashingDeviceStore(deviceStore, crash),
			secretStore,
			configurationConflicts: crashingConfigurationConflicts(configurationConflicts, crash),
			clock,
			scheduler,
			ui,
			schedule: () => device.schedule,
			deletionGuard: () => device.deletionGuard,
			configurationCategories: () => device.configurationCategories,
			pluginDir,
			pluginId,
			newDeviceId: () => crypto.randomUUID(),
		},
	};
	return device;
}

/**
 * Builds a device on `remote` as `createTestDevice` does with `options`,
 * already connected as the device named `name`, with its login secret
 * stored. A Remote without shared settings gets the defaults, as
 * connecting writes them.
 */
export function connectTestDevice(remote: FakeRemote, name: string, options: TestDeviceOptions = {}): TestDevice {
	const device = createTestDevice(remote, options);
	if (remote.get(SETTINGS_PATH) === undefined) {
		remote.put(METADATA_FOLDER, { kind: "folder" });
		remote.put(SETTINGS_PATH, {
			kind: "file",
			data: encodeSettings(DEFAULT_REMOTE_SETTINGS),
			revision: remote.nextRevision(),
		});
	}
	device.deviceStore.connection = { accountId: "account", remoteRoot: "", device: { id: `${name}-id`, name } };
	device.secretStore.setSecret(providerSecretId(TEST_PROVIDER_ID), `${name}-secret`);
	return device;
}

/** `vault` as the engine sees it, each write a step the device can crash at. */
function crashingVault(vault: FakeVault, crash: CrashPoints): LocalVault {
	return {
		configDir: vault.configDir,
		list: () => vault.list(),
		stat: (path) => vault.stat(path),
		read: (path) => vault.read(path),
		write: (path, data) => crash.step(`vault write ${path}`, () => vault.write(path, data)),
		replace: (path, expected, data) => crash.step(`vault replace ${path}`, () => vault.replace(path, expected, data)),
		createFolder: (path) => crash.step(`vault createFolder ${path}`, () => vault.createFolder(path)),
		trash: (path) => crash.step(`vault trash ${path}`, () => vault.trash(path)),
		rename: (from, to) => crash.step(`vault rename ${from}`, () => vault.rename(from, to)),
		lastTypedAt: (path) => vault.lastTypedAt(path),
		onChange: (listener) => vault.onChange(listener),
	};
}

/** `store` as the engine sees it, each keep and removal a step the device can crash at. */
function crashingConfigurationConflicts(store: InMemoryConfigurationConflicts, crash: CrashPoints): ConfigurationConflictStore {
	return {
		keep: (path, data, keptAt) => crash.step(`keep configuration ${path}`, () => store.keep(path, data, keptAt)),
		list: () => store.list(),
		read: (id) => store.read(id),
		remove: (id) => crash.step(`remove kept configuration ${id}`, () => store.remove(id)),
	};
}

/** `store` as the engine sees it, each save a step the device can crash at. */
function crashingDeviceStore(store: InMemoryDeviceStore, crash: CrashPoints): DeviceStore {
	return {
		loadConnection: () => store.loadConnection(),
		saveConnection: (connection) => crash.step("save Connection", () => store.saveConnection(connection)),
		loadSnapshot: () => store.loadSnapshot(),
		saveSnapshotEntry: (path, entry, base) =>
			crash.step(`save snapshot entry ${path}`, () => store.saveSnapshotEntry(path, entry, base)),
		removeSnapshotEntry: (path) =>
			crash.step(`remove snapshot entry ${path}`, () => store.removeSnapshotEntry(path)),
		moveSnapshotEntry: (from, to, entry) =>
			crash.step(`move snapshot entry ${from}`, () => store.moveSnapshotEntry(from, to, entry)),
		loadBase: (path) => store.loadBase(path),
		hasSnapshot: () => store.hasSnapshot(),
		markSnapshotComplete: () => crash.step("mark snapshot complete", () => store.markSnapshotComplete()),
		loadRemoteFeed: () => store.loadRemoteFeed(),
		saveRemoteFeed: (feed) => crash.step("save Remote feed", () => store.saveRemoteFeed(feed)),
		clear: () => crash.step("clear Device store", () => store.clear()),
	};
}
