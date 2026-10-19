import {
	providerSecretId,
	type Connection,
	type DeviceStore,
	type EnginePorts,
	type ProviderConnector,
	type SecretStore,
	type UiPort,
} from "../../src/engine/ports";
import type { VaultPath } from "../../src/engine/local-vault";
import type { Provider } from "../../src/engine/provider";
import type { SyncStatus } from "../../src/engine/status";
import type { SnapshotEntry, SyncSnapshot } from "../../src/engine/sync-snapshot";
import type { FakeProvider } from "./fake-provider";
import type { FakeRemote } from "./fake-remote";
import { FakeVault } from "./fake-vault";
import { ManualClock } from "./manual-clock";
import { ManualScheduler } from "./manual-scheduler";

/** The provider id of a test device's ProviderConnector. */
export const TEST_PROVIDER_ID = "fake-service";

/** A Device store in memory, holding at most one Connection and its Sync snapshot. */
export class InMemoryDeviceStore implements DeviceStore {
	/** The Sync snapshot, by vault path. */
	readonly snapshot = new Map<VaultPath, SnapshotEntry>();

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

	saveSnapshotEntry(path: VaultPath, entry: SnapshotEntry): Promise<void> {
		this.snapshot.set(path, entry);
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.connection = null;
		this.snapshot.clear();
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

/** A UI port that records what the engine showed. */
export class RecordingUi implements UiPort {
	/** Every status shown, oldest first. */
	readonly statuses: SyncStatus[] = [];

	/** The status shown last, or undefined if none was. */
	get lastStatus(): SyncStatus | undefined {
		return this.statuses[this.statuses.length - 1];
	}

	showStatus(status: SyncStatus): void {
		this.statuses.push(status);
	}
}

/** One simulated device: its fakes and the ports built from them. */
export interface TestDevice {
	/** The device's one Provider on the Remote, which tests steer (faults, crashes). */
	readonly provider: FakeProvider;
	readonly vault: FakeVault;
	readonly deviceStore: InMemoryDeviceStore;
	readonly secretStore: InMemorySecretStore;
	readonly clock: ManualClock;
	readonly scheduler: ManualScheduler;
	readonly ui: RecordingUi;
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
	const provider = remote.openProvider();
	const providers: ProviderConnector = {
		providerId: TEST_PROVIDER_ID,
		open: (): Promise<Provider> => Promise.resolve(provider),
	};
	return {
		provider,
		vault,
		deviceStore,
		secretStore,
		clock,
		scheduler,
		ui,
		ports: { providers, vault, deviceStore, secretStore, clock, scheduler, ui },
	};
}

/**
 * Builds a device on `remote` as `createTestDevice` does, already
 * connected as the device named `name`, with its login secret stored.
 */
export function connectTestDevice(remote: FakeRemote, name: string): TestDevice {
	const device = createTestDevice(remote);
	device.deviceStore.connection = { accountId: "account", remoteRoot: "", device: { id: `${name}-id`, name } };
	device.secretStore.setSecret(providerSecretId(TEST_PROVIDER_ID), `${name}-secret`);
	return device;
}
