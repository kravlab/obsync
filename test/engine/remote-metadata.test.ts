import { describe, expect, it } from "vitest";
import {
	DEFAULT_REMOTE_SETTINGS,
	DEVICES_FOLDER,
	METADATA_FOLDER,
	SETTINGS_PATH,
	devicePath,
	encodeDeviceRecord,
	encodeSettings,
	forgetDeviceRecord,
	readDeviceRecords,
	readRemoteSettings,
	writeRemoteSettings,
} from "../../src/engine/remote-metadata";
import { FakeRemote } from "../fakes/fake-remote";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";

/** A Remote holding the default shared settings, with the revision they were stored under. */
function remoteWithDefaults(): { remote: FakeRemote; revision: string } {
	const remote = new FakeRemote();
	remote.put(METADATA_FOLDER, { kind: "folder" });
	const revision = remote.nextRevision();
	remote.put(SETTINGS_PATH, { kind: "file", data: encodeSettings(DEFAULT_REMOTE_SETTINGS), revision });
	return { remote, revision };
}

describe("the shared settings", () => {
	it("are read with the revision they are stored under", async () => {
		const { remote, revision } = remoteWithDefaults();

		expect(await readRemoteSettings(remote.openProvider())).toEqual({ settings: DEFAULT_REMOTE_SETTINGS, revision });
	});

	it("are written over the revision read, and read back under a new one", async () => {
		const { remote, revision } = remoteWithDefaults();
		const provider = remote.openProvider();
		const changed = { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"] };

		await writeRemoteSettings(provider, changed, revision);

		const read = await readRemoteSettings(provider);
		expect(read?.settings).toEqual(changed);
		expect(read?.revision).not.toBe(revision);
	});

	it("are not written over a revision another device replaced", async () => {
		const { remote, revision } = remoteWithDefaults();
		const provider = remote.openProvider();
		await writeRemoteSettings(provider, { ...DEFAULT_REMOTE_SETTINGS, sizeCeilingBytes: 1_000 }, revision);

		await expectFailure(
			writeRemoteSettings(provider, { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["*.tmp"] }, revision),
			"preconditionFailed",
		);
		expect((await readRemoteSettings(provider))?.settings.sizeCeilingBytes).toBe(1_000);
	});
});

/** A Remote whose Metadata folder holds the records of `devices`, each with its "First sync in progress" mark if given. */
function remoteWithDevices(
	devices: readonly { readonly id: string; readonly name: string; readonly firstSyncStartedAt?: number }[],
): FakeRemote {
	const remote = new FakeRemote();
	remote.put(METADATA_FOLDER, { kind: "folder" });
	remote.put(DEVICES_FOLDER, { kind: "folder" });
	for (const { firstSyncStartedAt, ...device } of devices) {
		remote.put(devicePath(device), {
			kind: "file",
			data: encodeDeviceRecord(device, firstSyncStartedAt),
			revision: remote.nextRevision(),
		});
	}
	return remote;
}

/** The revision `remote` stores the record of the device `id` under. */
function recordRevision(remote: FakeRemote, id: string): string | undefined {
	const stored = remote.get(devicePath({ id, name: "" }));
	return stored?.kind === "file" ? stored.revision : undefined;
}

describe("the device records", () => {
	it("are read for every device, with its name, revision and mark", async () => {
		const remote = remoteWithDevices([
			{ id: "laptop-id", name: "Laptop" },
			{ id: "phone-id", name: "Phone", firstSyncStartedAt: 42 },
		]);

		const records = await readDeviceRecords(remote.openProvider());

		expect([...records].sort((a, b) => a.device.id.localeCompare(b.device.id))).toEqual([
			{ device: { id: "laptop-id", name: "Laptop" }, revision: recordRevision(remote, "laptop-id") },
			{ device: { id: "phone-id", name: "Phone" }, revision: recordRevision(remote, "phone-id"), firstSyncStartedAt: 42 },
		]);
	});

	it("pass over a file in the devices folder that is not a record", async () => {
		const remote = remoteWithDevices([{ id: "laptop-id", name: "Laptop" }]);
		remote.put(`${DEVICES_FOLDER}/notes.txt`, { kind: "file", data: bytes("hello"), revision: remote.nextRevision() });

		const records = await readDeviceRecords(remote.openProvider());

		expect(records.map((record) => record.device.name)).toEqual(["Laptop"]);
	});

	it("are none on a Remote without a devices folder", async () => {
		expect(await readDeviceRecords(new FakeRemote().openProvider())).toEqual([]);
	});

	it("lose a forgotten device's record and keep the others", async () => {
		const remote = remoteWithDevices([
			{ id: "laptop-id", name: "Laptop" },
			{ id: "phone-id", name: "Phone" },
		]);
		const provider = remote.openProvider();
		const phone = (await readDeviceRecords(provider)).find((record) => record.device.id === "phone-id");
		if (phone === undefined) throw new Error("no record of the phone");

		await forgetDeviceRecord(provider, phone);

		expect((await readDeviceRecords(provider)).map((record) => record.device.name)).toEqual(["Laptop"]);
	});

	it("keep a record its device rewrote since it was read", async () => {
		const remote = remoteWithDevices([{ id: "phone-id", name: "Phone" }]);
		const provider = remote.openProvider();
		const [phone] = await readDeviceRecords(provider);
		if (phone === undefined) throw new Error("no record of the phone");
		remote.put(devicePath(phone.device), {
			kind: "file",
			data: encodeDeviceRecord({ id: "phone-id", name: "Old phone" }),
			revision: remote.nextRevision(),
		});

		await expectFailure(forgetDeviceRecord(provider, phone), "preconditionFailed");
		expect((await readDeviceRecords(provider)).map((record) => record.device.name)).toEqual(["Old phone"]);
	});
});
