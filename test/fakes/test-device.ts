import type {
	Connection,
	DeviceStore,
	EnginePorts,
	ProviderConnector,
	SecretStore,
	UiPort,
} from "../../src/engine/ports";
import type { Provider } from "../../src/engine/provider";
import type { SyncStatus } from "../../src/engine/status";
import type { FakeRemote } from "./fake-remote";
import { FakeVault } from "./fake-vault";
import { ManualClock } from "./manual-clock";
import { ManualScheduler } from "./manual-scheduler";

/** A Device store in memory, holding at most one Connection. */
export class InMemoryDeviceStore implements DeviceStore {
	/** @param connection this device's Connection, or null for none */
	constructor(public connection: Connection | null = null) {}

	loadConnection(): Promise<Connection | null> {
		return Promise.resolve(this.connection);
	}

	saveConnection(connection: Connection): Promise<void> {
		this.connection = connection;
		return Promise.resolve();
	}

	clear(): Promise<void> {
		this.connection = null;
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
	readonly vault: FakeVault;
	readonly deviceStore: InMemoryDeviceStore;
	readonly secretStore: InMemorySecretStore;
	readonly clock: ManualClock;
	readonly scheduler: ManualScheduler;
	readonly ui: RecordingUi;
	readonly ports: EnginePorts;
}

/**
 * Builds a device whose provider opens on `remote`. Several devices built
 * on one FakeRemote sync the same Remote.
 */
export function createTestDevice(remote: FakeRemote): TestDevice {
	const clock = new ManualClock();
	const vault = new FakeVault({ clock });
	const deviceStore = new InMemoryDeviceStore();
	const secretStore = new InMemorySecretStore();
	const scheduler = new ManualScheduler(clock);
	const ui = new RecordingUi();
	const providers: ProviderConnector = {
		open: (): Promise<Provider> => Promise.resolve(remote.openProvider()),
	};
	return {
		vault,
		deviceStore,
		secretStore,
		clock,
		scheduler,
		ui,
		ports: { providers, vault, deviceStore, secretStore, clock, scheduler, ui },
	};
}
