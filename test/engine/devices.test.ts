import { describe, expect, it } from "vitest";
import { createConnectionService, type ConnectionService } from "../../src/engine/connection";
import { DEFAULT_REMOTE_SETTINGS, devicePath, encodeDeviceRecord } from "../../src/engine/remote-metadata";
import { createConnectingDevice, type ConnectingDevice } from "../fakes/connecting-device";
import type { FakeRemote } from "../fakes/fake-remote";
import { FakeService, type FakeAccount } from "../fakes/fake-service";

/** A connected device: its fakes and its connection service. */
interface Connected {
	readonly device: ConnectingDevice;
	readonly service: ConnectionService;
}

/**
 * Connects a new device of `fake` labelled `label`, named `name`, to the
 * Remote "My vault" of `account`, creating it when `create` says so.
 */
async function connect(fake: FakeService, account: FakeAccount, label: string, name: string, create: boolean): Promise<Connected> {
	const device = createConnectingDevice(fake, label);
	const service = createConnectionService(device.ports);
	const pending = await service.startAuthorization();
	const outcome = await pending.submitCode(account.approve(pending.authorizeUrl));
	if (outcome.kind !== "authorized") throw new Error(`expected authorized, got ${outcome.kind}`);
	if (create) await outcome.remotes.createRemote("My vault", name);
	else await outcome.remotes.useFolder("My vault", name);
	return { device, service };
}

/** A Remote with a laptop and a phone connected to it. */
async function laptopAndPhone(): Promise<{ remote: FakeRemote; laptop: Connected; phone: Connected }> {
	const fake = new FakeService();
	const account = fake.addAccount("account-1");
	const laptop = await connect(fake, account, "laptop", "Laptop", true);
	const phone = await connect(fake, account, "phone", "Phone", false);
	const remote = account.folders.get("My vault");
	if (remote === undefined) throw new Error("no Remote created");
	return { remote, laptop, phone };
}

describe("renaming this device", () => {
	it("stores the new name at once and leaves the record for the next sync to rewrite", async () => {
		const { laptop } = await laptopAndPhone();

		expect(await laptop.service.renameDevice("  Work laptop ")).toEqual({ kind: "renamed" });

		expect(await laptop.service.currentDevice()).toEqual({ id: "laptop-1", name: "Work laptop" });
		expect(laptop.device.deviceStore.connection?.deviceRecordOutdated).toBe(true);
	});

	it("refuses an empty name, keeping the old one", async () => {
		const { laptop } = await laptopAndPhone();

		expect(await laptop.service.renameDevice("   ")).toEqual({ kind: "emptyName" });

		expect(await laptop.service.currentDevice()).toEqual({ id: "laptop-1", name: "Laptop" });
		expect(laptop.device.deviceStore.connection?.deviceRecordOutdated).not.toBe(true);
	});
});

describe("the shared settings shown", () => {
	it("are none before a sync read them", async () => {
		const { laptop } = await laptopAndPhone();

		expect(await laptop.service.sharedSettings()).toBeNull();
	});

	it("are those the last sync read, or the ones a waiting change asks for", async () => {
		const { laptop } = await laptopAndPhone();
		const wanted = { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"] };
		laptop.device.deviceStore.knownSettings = DEFAULT_REMOTE_SETTINGS;

		expect(await laptop.service.sharedSettings()).toEqual(DEFAULT_REMOTE_SETTINGS);
		laptop.device.deviceStore.settingsChange = { base: DEFAULT_REMOTE_SETTINGS, wanted };
		expect(await laptop.service.sharedSettings()).toEqual(wanted);
	});
});

describe("the other devices", () => {
	it("are listed with their names, leaving this device out", async () => {
		const { laptop } = await laptopAndPhone();

		const others = await laptop.service.otherDevices();

		expect(others.map((record) => record.device)).toEqual([{ id: "phone-1", name: "Phone" }]);
	});

	it("can be forgotten, which deletes the record from the Remote", async () => {
		const { remote, laptop } = await laptopAndPhone();
		const [phone] = await laptop.service.otherDevices();
		if (phone === undefined) throw new Error("no record of the phone");

		expect(await laptop.service.forgetDevice(phone)).toEqual({ kind: "forgotten" });

		expect(remote.get(devicePath(phone.device))).toBeUndefined();
		expect(await laptop.service.otherDevices()).toEqual([]);
	});

	it("are not forgotten when the device rewrote its record since it was listed", async () => {
		const { remote, laptop } = await laptopAndPhone();
		const [phone] = await laptop.service.otherDevices();
		if (phone === undefined) throw new Error("no record of the phone");
		remote.put(devicePath(phone.device), {
			kind: "file",
			data: encodeDeviceRecord({ id: "phone-1", name: "Old phone" }),
			revision: remote.nextRevision(),
		});

		expect(await laptop.service.forgetDevice(phone)).toEqual({ kind: "changed" });

		expect((await laptop.service.otherDevices()).map((record) => record.device.name)).toEqual(["Old phone"]);
	});
});
