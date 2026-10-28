import { describe, expect, it } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import {
	DEFAULT_REMOTE_SETTINGS,
	METADATA_FOLDER,
	SETTINGS_PATH,
	encodeSettings,
	readDeviceRecords,
	readRemoteSettings,
	type RemoteSettings,
} from "../../src/engine/remote-metadata";
import { SimulatedCrash } from "../fakes/crash-points";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { forgetNotices, putRemoteFile, remoteText, syncNow, syncedPair, writeVaultFile } from "../support/sync";

/** The default shared settings with `overrides` on top. */
function settings(overrides: Partial<RemoteSettings>): RemoteSettings {
	return { ...DEFAULT_REMOTE_SETTINGS, ...overrides };
}

/** The shared settings `remote` holds now. */
async function remoteSettings(remote: FakeRemote): Promise<RemoteSettings | undefined> {
	return (await readRemoteSettings(remote.openProvider()))?.settings;
}

/** Replaces the shared settings on `remote` with `value`, as another device writing them would. */
function putSettings(remote: FakeRemote, value: RemoteSettings): Promise<void> {
	remote.put(SETTINGS_PATH, { kind: "file", data: encodeSettings(value), revision: remote.nextRevision() });
	return Promise.resolve();
}

/**
 * Changes the shared settings from `device` to `wanted`, as "Apply to all
 * devices" does with settings edited from `base`, by default those the
 * device knows, and waits for its sync.
 */
async function changeSettings(
	device: TestDevice,
	wanted: RemoteSettings,
	base: RemoteSettings = device.deviceStore.knownSettings ?? DEFAULT_REMOTE_SETTINGS,
): Promise<void> {
	await createSyncEngine(device.ports).changeSettings(base, wanted);
}

describe("a change of the shared settings", () => {
	it("is written to the Remote and takes effect on every device", async () => {
		const { remote, laptop, phone } = await syncedPair("note");
		const changed = settings({ ignoreList: ["Archive/"] });

		await changeSettings(laptop, changed);
		await writeVaultFile(phone, "Archive/old.md", "old");
		await syncNow(phone);

		expect(await remoteSettings(remote)).toEqual(changed);
		expect(laptop.deviceStore.settingsChange).toBeNull();
		expect(laptop.deviceStore.knownSettings).toEqual(changed);
		expect(phone.deviceStore.knownSettings).toEqual(changed);
		expect(remote.get("Archive/old.md")).toBeUndefined();
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("is brought to the Remote exactly once by the next sync after a crash at any step", async () => {
		const changed = settings({ ignoreList: ["Archive/"] });
		for (let step = 1; ; step += 1) {
			const { remote, laptop } = await syncedPair("note");
			laptop.crash.crashAfter(step);
			let crashed = false;
			try {
				await changeSettings(laptop, changed);
			} catch (error) {
				if (!(error instanceof SimulatedCrash)) throw error;
				crashed = true;
				await syncNow(laptop);
			}

			expect(await remoteSettings(remote)).toEqual(changed);
			expect(laptop.deviceStore.settingsChange).toBeNull();
			expect(laptop.ui.settingsCollisions).toEqual([]);
			expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
			if (!crashed) break;
		}
	});

	it("merges with a change of another setting made on another device before it", async () => {
		const { remote, laptop, phone } = await syncedPair("note");

		await changeSettings(laptop, settings({ ignoreList: ["Archive/"] }));
		await changeSettings(phone, settings({ sizeCeilingBytes: 1_000 }));

		const both = settings({ ignoreList: ["Archive/"], sizeCeilingBytes: 1_000 });
		expect(await remoteSettings(remote)).toEqual(both);
		expect(phone.deviceStore.knownSettings).toEqual(both);
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("leaves alone a setting another device changed since the settings it was edited from, though this device knows the new value", async () => {
		const { remote, laptop, phone } = await syncedPair("note");
		await changeSettings(phone, settings({ ignoreList: ["Archive/"] }));
		await syncNow(laptop);

		await changeSettings(laptop, settings({ textExtensions: ["md", "txt", "org"] }), DEFAULT_REMOTE_SETTINGS);

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"], textExtensions: ["md", "txt", "org"] }));
		expect(laptop.ui.settingsCollisions).toEqual([]);
	});

	it("brings a change made while the one before is written, even one back to the old value", async () => {
		const { remote, laptop } = await syncedPair("note");
		const engine = createSyncEngine(laptop.ports);
		const raised = settings({ sizeCeilingBytes: 200 * 1024 * 1024 });
		let revert: Promise<void> | undefined;
		laptop.provider.beforeNext("write", () => {
			// The user sets it back from the tab, which shows the value just applied.
			revert = engine.changeSettings(raised, DEFAULT_REMOTE_SETTINGS);
			return Promise.resolve();
		});

		await engine.changeSettings(DEFAULT_REMOTE_SETTINGS, raised);
		await revert;

		expect(await remoteSettings(remote)).toEqual(DEFAULT_REMOTE_SETTINGS);
		expect(laptop.deviceStore.settingsChange).toBeNull();
	});

	it("keeps a change made before the one waiting was written, together with it", async () => {
		const { remote, laptop } = await syncedPair("note");
		const first = settings({ ignoreList: ["Archive/"] });
		laptop.deviceStore.settingsChange = { base: DEFAULT_REMOTE_SETTINGS, wanted: first };

		await changeSettings(laptop, settings({ ignoreList: ["Archive/"], sizeCeilingBytes: 1_000 }), first);

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"], sizeCeilingBytes: 1_000 }));
	});

	it("leaves for the next sync a change made from other settings while the one before is written", async () => {
		const { remote, laptop } = await syncedPair("note");
		const other = settings({ textExtensions: ["md"] });
		const newer = { base: other, wanted: settings({ textExtensions: ["md", "org"] }) };
		laptop.provider.beforeNext("write", () => {
			laptop.deviceStore.settingsChange = newer;
			return Promise.resolve();
		});

		await changeSettings(laptop, settings({ ignoreList: ["Archive/"] }));

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"] }));
		expect(laptop.deviceStore.settingsChange).toEqual(newer);
	});

	it("stops, keeping the change, when the settings another device wrote meanwhile cannot be read", async () => {
		const { remote, laptop } = await syncedPair("note");
		laptop.provider.beforeNext("write", () => {
			remote.put(SETTINGS_PATH, { kind: "file", data: bytes("not settings"), revision: remote.nextRevision() });
			return Promise.resolve();
		});

		await changeSettings(laptop, settings({ ignoreList: ["Archive/"] }));

		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed", cause: "unreadableSettings" });
		expect(laptop.deviceStore.settingsChange?.wanted).toEqual(settings({ ignoreList: ["Archive/"] }));
	});

	it("merges again when another device's change lands between its read and its write", async () => {
		const { remote, laptop } = await syncedPair("note");
		laptop.provider.beforeNext("write", async () => {
			await putSettings(remote, settings({ textExtensions: ["md", "txt", "org"] }));
		});

		await changeSettings(laptop, settings({ ignoreList: ["Archive/"] }));

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"], textExtensions: ["md", "txt", "org"] }));
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});
});

describe("a change of the name policy", () => {
	/** A laptop and a phone synced on a Remote with a change feed whose service refuses a backslash, as Dropbox does. */
	async function backslashPair(): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
		const remote = new FakeRemote({ changeFeed: true, nameRules: { forbiddenCharacters: ["\\"] } });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "note.md", "note");
		await syncNow(laptop);
		await syncNow(phone);
		forgetNotices(laptop, phone);
		return { remote, laptop, phone };
	}

	it("is refused while a Remote name would be read as another file, naming it, and the other settings still change", async () => {
		const { remote, laptop } = await backslashPair();
		putRemoteFile(remote, "a＼b.md", "literal");
		await syncNow(laptop);

		await changeSettings(laptop, settings({ namePolicy: "encodeReversibly", sizeCeilingBytes: 1_000 }));

		expect(laptop.ui.notices).toEqual([{ kind: "namePolicyRefused", paths: ["a＼b.md"] }]);
		expect(await remoteSettings(remote)).toEqual(settings({ sizeCeilingBytes: 1_000 }));
		expect(laptop.deviceStore.settingsChange).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("is refused back to skipping while a Remote name is encoded, naming the vault path it stands for", async () => {
		const remote = new FakeRemote({ nameRules: { forbiddenCharacters: ["\\"] } });
		remote.put(METADATA_FOLDER, { kind: "folder" });
		await putSettings(remote, settings({ namePolicy: "encodeReversibly" }));
		putRemoteFile(remote, "a＼b.md", "encoded");
		const laptop = connectTestDevice(remote, "Laptop");
		await syncNow(laptop);
		forgetNotices(laptop);

		await changeSettings(laptop, settings({ namePolicy: "skipAndReport" }));

		expect(laptop.ui.notices).toEqual([{ kind: "namePolicyRefused", paths: ["a\\b.md"] }]);
		expect(await remoteSettings(remote)).toEqual(settings({ namePolicy: "encodeReversibly" }));
	});

	it("once written, has every other device list the Remote in full and sync the names it now stores", async () => {
		const { remote, laptop, phone } = await backslashPair();
		await writeVaultFile(phone, "a\\b.md", "backslash");
		await syncNow(phone);
		expect(remote.get("a＼b.md")).toBeUndefined();
		let listedInFull = false;
		phone.provider.beforeNext("list", () => {
			listedInFull = true;
			return Promise.resolve();
		});

		await changeSettings(laptop, settings({ namePolicy: "encodeReversibly" }));
		await syncNow(phone);

		expect(laptop.ui.notices).toEqual([]);
		expect(await remoteSettings(remote)).toEqual(settings({ namePolicy: "encodeReversibly" }));
		expect(listedInFull).toBe(true);
		expect(remoteText(remote, "a＼b.md")).toBe("backslash");
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});
});

describe("a renamed device", () => {
	it("has its record rewritten with the new name by its next completed sync", async () => {
		const { remote, phone } = await syncedPair("note");
		const connection = phone.deviceStore.connection;
		if (connection === null) throw new Error("the phone is not connected");
		phone.deviceStore.connection = { ...connection, device: { ...connection.device, name: "Old phone" }, deviceRecordOutdated: true };

		await syncNow(phone);

		const records = await readDeviceRecords(remote.openProvider());
		expect(records.find((record) => record.device.id === connection.device.id)?.device.name).toBe("Old phone");
		expect(phone.deviceStore.connection?.deviceRecordOutdated).toBe(false);
	});

	it("keeps a name given while its First sync's end writes the record, for the next sync to write", async () => {
		const remote = new FakeRemote();
		putRemoteFile(remote, "note.md", "note");
		const phone = connectTestDevice(remote, "Phone");
		// The First sync writes the marked record first, then the record without the mark once done.
		phone.provider.beforeNext("write", () => Promise.resolve());
		phone.provider.beforeNext("write", () => {
			const connection = phone.deviceStore.connection;
			if (connection !== null) {
				phone.deviceStore.connection = { ...connection, device: { ...connection.device, name: "Old phone" }, deviceRecordOutdated: true };
			}
			return Promise.resolve();
		});

		await syncNow(phone);
		expect(phone.deviceStore.connection?.device.name).toBe("Old phone");
		expect(phone.deviceStore.connection?.firstSyncDone).toBe(true);
		await syncNow(phone);

		const records = await readDeviceRecords(remote.openProvider());
		expect(records.map((record) => record.device.name)).toEqual(["Old phone"]);
		expect(phone.deviceStore.connection?.deviceRecordOutdated).toBe(false);
	});

	it("keeps its record outdated while sync is held, so a later sync still rewrites it", async () => {
		const { remote, laptop, phone } = await syncedPair("note");
		await changeSettings(laptop, settings({ ignoreList: ["Archive/"] }));
		const connection = phone.deviceStore.connection;
		if (connection === null) throw new Error("the phone is not connected");
		phone.deviceStore.connection = { ...connection, device: { ...connection.device, name: "Old phone" }, deviceRecordOutdated: true };
		phone.ui.settingsCollisionAnswers.push(null);

		await changeSettings(phone, settings({ ignoreList: ["*.tmp"] }));

		const records = await readDeviceRecords(remote.openProvider());
		expect(records.find((record) => record.device.id === connection.device.id)?.device.name).toBe("Phone");
		expect(phone.deviceStore.connection?.deviceRecordOutdated).toBe(true);
	});
});

describe("a collision of two changes", () => {
	/** A synced pair where the laptop changed the ignore list and the phone changed it otherwise, unaware. */
	async function collidingPair(): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
		const pair = await syncedPair("note");
		await changeSettings(pair.laptop, settings({ ignoreList: ["Archive/"] }));
		return pair;
	}

	it("asks which value to keep, and writes this device's when the user picks it", async () => {
		const { remote, phone } = await collidingPair();
		phone.ui.settingsCollisionAnswers.push({ keepMine: ["ignoreList"] });

		await changeSettings(phone, settings({ ignoreList: ["*.tmp"], sizeCeilingBytes: 1_000 }));

		expect(phone.ui.settingsCollisions).toEqual([
			{
				collisions: ["ignoreList"],
				mine: settings({ ignoreList: ["*.tmp"], sizeCeilingBytes: 1_000 }),
				remote: settings({ ignoreList: ["Archive/"] }),
			},
		]);
		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["*.tmp"], sizeCeilingBytes: 1_000 }));
		expect(phone.deviceStore.settingsChange).toBeNull();
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("keeps the Remote's value when the user picks it, still writing the settings that did not collide", async () => {
		const { remote, phone } = await collidingPair();
		phone.ui.settingsCollisionAnswers.push({ keepMine: [] });

		await changeSettings(phone, settings({ ignoreList: ["*.tmp"], sizeCeilingBytes: 1_000 }));

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"], sizeCeilingBytes: 1_000 }));
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("writes nothing when the device is disconnected while the prompt is open", async () => {
		const { remote, phone } = await collidingPair();
		phone.ui.onAsk = () => {
			phone.ui.onAsk = undefined;
			phone.epoch.advance();
			phone.deviceStore.connection = null;
		};
		phone.ui.settingsCollisionAnswers.push({ keepMine: ["ignoreList"] });

		await changeSettings(phone, settings({ ignoreList: ["*.tmp"] }));

		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"] }));
		expect(phone.ui.lastStatus).toEqual({ state: "syncing" });
	});

	it("holds sync, writing nothing, while the prompt is closed without an answer, and asks again when the user syncs", async () => {
		const { remote, phone } = await collidingPair();
		phone.ui.settingsCollisionAnswers.push(null);
		await writeVaultFile(phone, "new.md", "new");
		const engine = createSyncEngine(phone.ports);

		await engine.changeSettings(DEFAULT_REMOTE_SETTINGS, settings({ ignoreList: ["*.tmp"] }));
		await engine.sync("automatic");

		expect(phone.ui.lastStatus).toEqual({ state: "settingsCollision" });
		expect(phone.ui.settingsCollisions).toHaveLength(1);
		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["Archive/"] }));
		expect(remote.get("new.md")).toBeUndefined();
		expect(phone.deviceStore.settingsChange?.wanted).toEqual(settings({ ignoreList: ["*.tmp"] }));

		phone.ui.settingsCollisionAnswers.push({ keepMine: ["ignoreList"] });
		await engine.sync();

		expect(phone.ui.settingsCollisions).toHaveLength(2);
		expect(await remoteSettings(remote)).toEqual(settings({ ignoreList: ["*.tmp"] }));
		expect(remote.get("new.md")?.kind).toBe("file");
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});
});
