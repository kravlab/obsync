import { describe, expect, it } from "vitest";
import { FakeRemote, type FakeServiceOptions } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { createSyncEngine } from "../../src/engine/engine";
import { parentOf } from "../../src/engine/paths";
import { DEVICES_FOLDER, SETTINGS_PATH, devicePath } from "../../src/engine/remote-metadata";
import { SimulatedCrash } from "../fakes/fake-provider";
import { mirror, remoteText, syncNow, vaultText } from "../support/sync";

/** A Remote on a service with `service`, holding what the laptop synced: `files`, by path. */
async function remoteWith(
	files: Readonly<Record<string, string>>,
	service: FakeServiceOptions = {},
): Promise<{ remote: FakeRemote; laptop: TestDevice }> {
	const remote = new FakeRemote(service);
	const laptop = connectTestDevice(remote, "Laptop");
	for (const [path, content] of Object.entries(files)) await laptop.vault.write(path, bytes(content));
	await syncNow(laptop);
	return { remote, laptop };
}

describe("identical files on a First sync", () => {
	it("are recorded without a download when the provider's hash proves them identical", async () => {
		const { remote } = await remoteWith({ "note.md": "same", "photo.png": "same photo" }, { serverHashes: true });
		const phone = connectTestDevice(remote, "Phone");
		await phone.vault.write("note.md", bytes("same"));
		await phone.vault.write("photo.png", bytes("same photo"));
		for (const path of ["note.md", "photo.png"]) {
			phone.provider.beforeNextRead(path, () => Promise.reject(new Error(`downloaded ${path}`)));
		}

		await syncNow(phone);

		expect([...phone.deviceStore.snapshot.keys()].sort()).toEqual(["note.md", "photo.png"]);
		expect(phone.ui.notices).toEqual([{ kind: "firstSyncDone", downloaded: 0, uploaded: 0, conflicted: 0, conflictCopies: 0 }]);
	});
});

/**
 * A Remote the laptop synced with `remote.md`, `same.md`, `differs.md` and
 * `differs.png`, and a phone, connected but not synced, whose vault holds
 * `phone.md`, `same.md` and its own `differs.md` and `differs.png`.
 */
async function bothFull(service: FakeServiceOptions = {}): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const { remote, laptop } = await remoteWith(
		{
			"remote.md": "from the Remote",
			"same.md": "same",
			"differs.md": "line 1\nfrom the laptop",
			"differs.png": "laptop photo",
		},
		service,
	);
	const phone = connectTestDevice(remote, "Phone");
	await phone.vault.write("phone.md", bytes("from the phone"));
	await phone.vault.write("same.md", bytes("same"));
	await phone.vault.write("differs.md", bytes("line 1\nfrom the phone"));
	await phone.vault.write("differs.png", bytes("phone photo"));
	return { remote, laptop, phone };
}

describe("the First sync preview", () => {
	it("lists what would be downloaded, uploaded, identical and differing, and changes nothing until started", async () => {
		const { remote, phone } = await bothFull();
		const mirrorBefore = mirror(remote);
		phone.ui.firstSyncAnswers.push(null);

		await syncNow(phone);

		expect(phone.ui.previews).toEqual([
			{
				toDownload: ["remote.md"],
				toUpload: ["phone.md"],
				identical: ["same.md"],
				differing: [
					{ path: "differs.md", outcome: "merged" },
					{ path: "differs.png", outcome: "conflictCopy" },
				],
			},
		]);
		expect(mirror(remote)).toEqual(mirrorBefore);
		expect((await phone.vault.list()).map(({ path }) => path).sort()).toEqual(["differs.md", "differs.png", "phone.md", "same.md"]);
		expect(phone.deviceStore.snapshot.size).toBe(0);
		expect(phone.ui.lastStatus).toEqual({ state: "firstSyncWaiting" });
	});

	it("tells a JSON file both sides hold differently as merged, or a conflict copy if it cannot be merged", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("board.canvas", bytes('{"nodes":["laptop"]}'));
		await laptop.vault.write("data.json", bytes('{"from":"laptop"}'));
		await syncNow(laptop);
		const phone = connectTestDevice(remote, "Phone");
		await phone.vault.write("board.canvas", bytes('{"nodes":["phone"]}'));
		await phone.vault.write("data.json", bytes('{"from":"phone"}'));
		phone.ui.firstSyncAnswers.push(null);

		await syncNow(phone);

		expect(phone.ui.previews[0]?.differing).toEqual([
			{ path: "board.canvas", outcome: "mergedOrConflictCopy" },
			{ path: "data.json", outcome: "mergedOrConflictCopy" },
		]);
	});

	it("asks again only when the user asks for a sync, not on automatic triggers", async () => {
		const { phone } = await bothFull();
		const engine = createSyncEngine(phone.ports);
		phone.ui.firstSyncAnswers.push(null);
		await engine.sync();

		await engine.sync("automatic");
		expect(phone.ui.previews).toHaveLength(1);
		expect(phone.ui.lastStatus).toEqual({ state: "firstSyncWaiting" });

		await engine.sync();
		expect(phone.ui.previews).toHaveLength(2);
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("is shown once: a device whose First sync completed syncs as usual", async () => {
		const { phone } = await bothFull();
		await syncNow(phone);
		await syncNow(phone);
		expect(phone.ui.previews).toHaveLength(1);
	});

	it("shows only downloads for an empty vault, and only uploads for an empty Remote", async () => {
		const { remote } = await remoteWith({ "a.md": "a", "b.png": "b" });
		const newDevice = connectTestDevice(remote, "Phone");
		await syncNow(newDevice);
		const emptyRemote = new FakeRemote();
		const firstDevice = connectTestDevice(emptyRemote, "Tablet");
		await firstDevice.vault.write("c.md", bytes("c"));
		await syncNow(firstDevice);

		expect(newDevice.ui.previews).toEqual([{ toDownload: ["a.md", "b.png"], toUpload: [], identical: [], differing: [] }]);
		expect(firstDevice.ui.previews).toEqual([{ toDownload: [], toUpload: ["c.md"], identical: [], differing: [] }]);
		expect(await vaultText(newDevice, "b.png")).toBe("b");
		expect(remoteText(emptyRemote, "c.md")).toBe("c");
	});
});

describe("a First sync of two full sides", () => {
	it("adds what one side lacks, merges differing text and makes a Conflict copy of the rest, deleting nothing", async () => {
		const { remote, phone } = await bothFull();

		await syncNow(phone);

		expect(await vaultText(phone, "remote.md")).toBe("from the Remote");
		expect(remoteText(remote, "phone.md")).toBe("from the phone");
		expect(await vaultText(phone, "differs.md")).toContain("<<<<<<< Phone");
		expect(remoteText(remote, "differs.md")).toBe(await vaultText(phone, "differs.md"));
		expect(remoteText(remote, "differs.png")).toBe("laptop photo");
		expect(remoteText(remote, `differs (conflict Phone ${localStamp(phone)}).png`)).toBe("phone photo");
		expect(phone.vault.trashed).toEqual([]);
		expect(phone.ui.notices).toEqual([{ kind: "firstSyncDone", downloaded: 1, uploaded: 1, conflicted: 1, conflictCopies: 1 }]);
	});

	it("keeps the Remote version of every differing file and the vault's as a Conflict copy, when asked to", async () => {
		const { remote, phone } = await bothFull();
		phone.ui.firstSyncAnswers.push({ differing: "keepRemote" });

		await syncNow(phone);

		const stamp = localStamp(phone);
		expect(await vaultText(phone, "differs.md")).toBe("line 1\nfrom the laptop");
		expect(remoteText(remote, `differs (conflict Phone ${stamp}).md`)).toBe("line 1\nfrom the phone");
		expect(remoteText(remote, `differs (conflict Phone ${stamp}).png`)).toBe("phone photo");
		expect(phone.ui.notices).toEqual([{ kind: "firstSyncDone", downloaded: 1, uploaded: 1, conflicted: 0, conflictCopies: 2 }]);
	});
});

/** The local date and time `device`'s clock is at, as a Conflict copy name has it. */
function localStamp(device: TestDevice): string {
	const now = new Date(device.clock.now());
	const two = (value: number): string => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}`;
}

/** The device records in `remote`'s Metadata folder, each as its device's name and ID. */
function deviceRecords(remote: FakeRemote): { readonly deviceName: unknown; readonly deviceId: unknown }[] {
	return deviceRecordPaths(remote).map((path) => {
		const { deviceName, deviceId } = recordOf(remote, path) as Record<string, unknown>;
		return { deviceName, deviceId };
	});
}

/** The paths of the device records in `remote`, sorted. */
function deviceRecordPaths(remote: FakeRemote): string[] {
	return remote
		.list()
		.filter((entry) => entry.kind === "file" && parentOf(entry.path) === DEVICES_FOLDER)
		.map(({ path }) => path)
		.sort();
}

describe("a device that lost its Sync snapshot", () => {
	it("does a First sync and registers again under a new Device ID, the old record left to age out", async () => {
		const { remote, laptop } = await remoteWith({ "note.md": "synced" });
		laptop.deviceStore.loseSnapshot();

		await syncNow(laptop);
		await syncNow(laptop);

		expect(laptop.ui.previews).toHaveLength(2);
		expect(laptop.ui.previews[1]?.identical).toEqual(["note.md"]);
		const records = deviceRecords(remote);
		expect(records.map(({ deviceName }) => deviceName)).toEqual(["Laptop", "Laptop"]);
		expect(new Set(records.map(({ deviceId }) => deviceId)).size).toBe(2);
	});

	it("keeps the new Device ID when that First sync is cut off and done again", async () => {
		const { remote, laptop } = await remoteWith({ "note.md": "synced" });
		laptop.deviceStore.loseSnapshot();
		// Cut off at the first write once started: the new record.
		laptop.provider.beforeNext("write", () => Promise.reject(new SimulatedCrash("cut off")));

		await expect(syncNow(laptop)).rejects.toBeInstanceOf(SimulatedCrash);
		await syncNow(laptop);
		await syncNow(laptop);

		expect(deviceRecords(remote)).toHaveLength(2);
		expect(laptop.ui.previews).toHaveLength(3);
	});
});

describe("a First sync cut off half way", () => {
	it("is done again, preview included, keeping what it already recorded", async () => {
		const { remote } = await remoteWith({ "a.md": "a", "b.md": "b" });
		const phone = connectTestDevice(remote, "Phone");
		phone.provider.beforeNextRead("b.md", () => Promise.reject(new SimulatedCrash("cut off")));

		await expect(syncNow(phone)).rejects.toBeInstanceOf(SimulatedCrash);
		await syncNow(phone);
		await syncNow(phone);

		expect(phone.ui.previews).toHaveLength(2);
		expect(phone.ui.previews[1]).toMatchObject({ toDownload: ["b.md"], identical: ["a.md"] });
		expect(await vaultText(phone, "b.md")).toBe("b");
		expect(
			deviceRecords(remote)
				.map(({ deviceName }) => deviceName)
				.sort(),
		).toEqual(["Laptop", "Phone"]);
	});
});

describe("the First sync in progress mark", () => {
	it("is in the device's record while its First sync runs, and cleared once it completes", async () => {
		const { remote } = await remoteWith({ "remote.md": "from the Remote" });
		const phone = connectTestDevice(remote, "Phone");
		phone.clock.advance(1_000);
		const record = devicePath({ id: "Phone-id", name: "Phone" });
		let duringSync: unknown;
		phone.vault.beforeNextWrite("remote.md", () => {
			duringSync = recordOf(remote, record);
			return Promise.resolve();
		});

		await syncNow(phone);

		expect(duringSync).toMatchObject({ deviceName: "Phone", firstSyncStartedAt: 1_000 });
		expect(recordOf(remote, record)).not.toHaveProperty("firstSyncStartedAt");
	});
});

/** The parsed JSON of the Remote file at `path`. */
function recordOf(remote: FakeRemote, path: string): unknown {
	return JSON.parse(remoteText(remote, path));
}

describe("two devices setting up one empty Remote at once", () => {
	it("keep one settings file and end with the union of their files", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		const settingsBefore = remote.get(SETTINGS_PATH);
		await laptop.vault.write("laptop.md", bytes("from the laptop"));
		await laptop.vault.write("both.md", bytes("same on both"));
		await phone.vault.write("phone.md", bytes("from the phone"));
		await phone.vault.write("both.md", bytes("same on both"));

		await Promise.all([syncNow(laptop), syncNow(phone)]);
		await syncNow(laptop);
		await syncNow(phone);

		expect(remote.get(SETTINGS_PATH)).toBe(settingsBefore);
		expect(
			mirror(remote)
				.map(({ path }) => path)
				.sort(),
		).toEqual(["both.md", "laptop.md", "phone.md"]);
		for (const device of [laptop, phone]) {
			expect(await vaultText(device, "laptop.md")).toBe("from the laptop");
			expect(await vaultText(device, "phone.md")).toBe("from the phone");
			expect(await vaultText(device, "both.md")).toBe("same on both");
		}
	});
});

describe("a First sync with entries left from an earlier one cut off", () => {
	it("deletes nothing: a file another device deleted meanwhile is uploaded again, as the preview says", async () => {
		const { remote, laptop } = await remoteWith({ "a.md": "a", "b.md": "b" });
		const phone = connectTestDevice(remote, "Phone");
		phone.provider.beforeNextRead("b.md", () => Promise.reject(new SimulatedCrash("cut off")));
		await expect(syncNow(phone)).rejects.toBeInstanceOf(SimulatedCrash);
		await laptop.vault.trash("a.md");
		await syncNow(laptop);

		await syncNow(phone);

		expect(phone.ui.previews[1]).toMatchObject({ toUpload: ["a.md"], toDownload: ["b.md"] });
		expect(phone.vault.trashed).toEqual([]);
		expect(await vaultText(phone, "a.md")).toBe("a");
		expect(remoteText(remote, "a.md")).toBe("a");
	});
});
