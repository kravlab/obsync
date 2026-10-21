import {
	providerSecretId,
	type Connection,
	type DeviceStore,
	type EnginePorts,
	type ProviderConnector,
	type RemoteFeed,
	type SecretStore,
	type UiPort,
} from "../../src/engine/ports";
import { DEFAULT_DELETION_GUARD, type DeletionAnswer, type DeletionGuardSettings, type DeletionPrompt } from "../../src/engine/deletion-guard";
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

/** A UI port that records what the engine showed, and answers its prompts as scripted. */
export class RecordingUi implements UiPort {
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

	/** The status shown last, or undefined if none was. */
	get lastStatus(): SyncStatus | undefined {
		return this.statuses[this.statuses.length - 1];
	}

	showStatus(status: SyncStatus): void {
		this.statuses.push(status);
	}

	/** Records `notice` instead of showing it. */
	showNotice(notice: SyncNotice): void {
		this.notices.push(notice);
	}

	/** Records `prompt` and gives the next scripted answer; an unscripted prompt is a test failure. */
	askDeletions(prompt: DeletionPrompt): Promise<DeletionAnswer> {
		this.prompts.push(prompt);
		this.onAsk?.();
		if (this.answers.length === 0) return Promise.reject(new Error("unexpected Deletion guard prompt"));
		return Promise.resolve(this.answers.shift() ?? null);
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
	readonly clock: ManualClock;
	readonly scheduler: ManualScheduler;
	readonly ui: RecordingUi;
	/** The device's schedule settings; tests may replace it at any time. */
	schedule: SyncSchedule;
	/** The device's Deletion guard thresholds; tests may replace them at any time. */
	deletionGuard: DeletionGuardSettings;
	readonly ports: EnginePorts;
}

/**
 * Builds a device whose provider opens on `remote`, always as the same
 * FakeProvider, so faults a test injects reach the engine. Several devices
 * built on one FakeRemote sync the same Remote. The device has no
 * Connection; `connectTestDevice` gives it one.
 */
export function createTestDevice(remote: FakeRemote): TestDevice {
	const clock = new ManualClock();
	const vault = new FakeVault({ clock });
	const deviceStore = new InMemoryDeviceStore();
	const secretStore = new InMemorySecretStore();
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
		clock,
		scheduler,
		ui,
		schedule: DEFAULT_SYNC_SCHEDULE,
		deletionGuard: DEFAULT_DELETION_GUARD,
		ports: {
			providers,
			vault: crashingVault(vault, crash),
			deviceStore: crashingDeviceStore(deviceStore, crash),
			secretStore,
			clock,
			scheduler,
			ui,
			schedule: () => device.schedule,
			deletionGuard: () => device.deletionGuard,
		},
	};
	return device;
}

/**
 * Builds a device on `remote` as `createTestDevice` does, already
 * connected as the device named `name`, with its login secret stored. A
 * Remote without shared settings gets the defaults, as connecting writes
 * them.
 */
export function connectTestDevice(remote: FakeRemote, name: string): TestDevice {
	const device = createTestDevice(remote);
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
		loadRemoteFeed: () => store.loadRemoteFeed(),
		saveRemoteFeed: (feed) => crash.step("save Remote feed", () => store.saveRemoteFeed(feed)),
		clear: () => crash.step("clear Device store", () => store.clear()),
	};
}
