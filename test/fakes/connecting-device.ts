import type { ConnectionPorts } from "../../src/engine/connection";
import type { FakeService, FakeConnectStep } from "./fake-service";
import { ManualClock } from "./manual-clock";
import { InMemoryDeviceStore, InMemorySecretStore, RecordingUi } from "./test-device";

/** One simulated device as far as connecting goes: its fakes and ports. */
export interface ConnectingDevice {
	readonly connectStep: FakeConnectStep;
	readonly deviceStore: InMemoryDeviceStore;
	readonly secretStore: InMemorySecretStore;
	readonly ui: RecordingUi;
	readonly clock: ManualClock;
	readonly ports: ConnectionPorts;
}

/**
 * Builds a device that connects through `service`. Its Device IDs are
 * `<label>-1`, `<label>-2`, … in the order it creates them, so tests can
 * name the records it writes.
 */
export function createConnectingDevice(service: FakeService, label: string): ConnectingDevice {
	const connectStep = service.connectStep();
	const deviceStore = new InMemoryDeviceStore();
	const secretStore = new InMemorySecretStore();
	const ui = new RecordingUi();
	const clock = new ManualClock();
	let created = 0;
	const newDeviceId = (): string => {
		created += 1;
		return `${label}-${created}`;
	};
	return {
		connectStep,
		deviceStore,
		secretStore,
		ui,
		clock,
		ports: { connectStep, deviceStore, secretStore, ui, newDeviceId, clock },
	};
}
