import { describe, expect, it } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { bytes, text } from "../support/bytes";
import { FakeRemote } from "../fakes/fake-remote";
import { createTestDevice } from "../fakes/test-device";

describe("sync engine", () => {
	it("reports Not connected on a device that has no Connection", async () => {
		const device = createTestDevice(new FakeRemote());
		await createSyncEngine(device.ports).start();
		expect(device.ui.statuses).toEqual([{ state: "notConnected" }]);
	});

	it("reports Connected on a device that has a Connection", async () => {
		const device = createTestDevice(new FakeRemote());
		device.deviceStore.connection = {
			accountId: "account",
			remoteRoot: "My vault",
			device: { id: "laptop-id", name: "Laptop" },
		};
		await createSyncEngine(device.ports).start();
		expect(device.ui.statuses).toEqual([{ state: "connected" }]);
	});

	it("runs one engine per device on a shared Remote, each with its own stores", async () => {
		const remote = new FakeRemote();
		const laptop = createTestDevice(remote);
		const phone = createTestDevice(remote);
		await createSyncEngine(laptop.ports).start();
		await createSyncEngine(phone.ports).start();
		expect(laptop.ui.statuses).toEqual([{ state: "notConnected" }]);
		expect(phone.ui.statuses).toEqual([{ state: "notConnected" }]);
		expect(laptop.vault).not.toBe(phone.vault);
		expect(laptop.deviceStore).not.toBe(phone.deviceStore);

		const connection = { accountId: "account", remoteRoot: "", device: { id: "laptop-id", name: "Laptop" } };
		const laptopProvider = await laptop.ports.providers.open(connection, "secret");
		const phoneProvider = await phone.ports.providers.open(connection, "secret");
		await laptopProvider.write("note.md", bytes("from laptop"));
		expect(text(await phoneProvider.read("note.md"))).toBe("from laptop");
	});
});
