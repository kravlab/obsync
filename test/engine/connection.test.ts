import { describe, expect, it } from "vitest";
import { createConnectionService, type AuthorizationOutcome } from "../../src/engine/connection";
import { SimulatedCrash } from "../fakes/fake-provider";
import { connectTestDevice } from "../fakes/test-device";
import { syncNow } from "../support/sync";
import { bytes, text } from "../support/bytes";
import { FakeService, type FakeAccount } from "../fakes/fake-service";
import type { FakeRemote } from "../fakes/fake-remote";
import { createConnectingDevice, type ConnectingDevice } from "../fakes/connecting-device";

/** Logs `device` in to `account` and returns the outcome of the pasted code. */
async function logIn(device: ConnectingDevice, account: FakeAccount): Promise<AuthorizationOutcome> {
	const pending = await createConnectionService(device.ports).startAuthorization();
	return pending.submitCode(account.approve(pending.authorizeUrl));
}

/** Logs in like `logIn`, expecting an account with no Connection yet. */
async function authorize(device: ConnectingDevice, account: FakeAccount) {
	const outcome = await logIn(device, account);
	if (outcome.kind !== "authorized") throw new Error(`expected authorized, got ${outcome.kind}`);
	return outcome.remotes;
}

/** Parses the JSON file at `path` of `remote`. */
function readJson(remote: FakeRemote | undefined, path: string): unknown {
	const stored = remote?.get(path);
	if (stored?.kind !== "file") throw new Error(`no file at ${path}`);
	return JSON.parse(text(stored.data));
}

/** Six hours, after which a "First sync in progress" mark is stale. */
const MARK_TIMEOUT_MS = 6 * 60 * 60 * 1_000;

/**
 * An account with the Remote "My vault", set up by a laptop, where the
 * device "Tablet" started its First sync at `startedAt` by its clock and
 * was cut off uploading its note, so its record keeps the mark.
 */
async function remoteWithMark(startedAt: number) {
	const service = new FakeService();
	const account = service.addAccount("account-1");
	await (await authorize(createConnectingDevice(service, "laptop"), account)).createRemote("My vault", "Laptop");
	const remote = account.folders.get("My vault");
	if (remote === undefined) throw new Error("no Remote created");
	const tablet = connectTestDevice(remote, "Tablet");
	tablet.clock.advance(startedAt);
	await tablet.vault.write("note.md", bytes("from the tablet"));
	// The first write once started is the marked record; the second, the note, is cut off.
	tablet.provider.beforeNext("write", () => Promise.resolve());
	tablet.provider.beforeNext("write", () => Promise.reject(new SimulatedCrash("cut off")));
	await expect(syncNow(tablet)).rejects.toBeInstanceOf(SimulatedCrash);
	return { service, account };
}

describe("connecting while another device does its First sync", () => {
	it("tells the device to wait, naming the other device, and changes nothing", async () => {
		const { service, account } = await remoteWithMark(0);
		const phone = createConnectingDevice(service, "phone");

		const outcome = await (await authorize(phone, account)).useFolder("My vault", "Phone");

		expect(outcome).toEqual({ kind: "firstSyncInProgress", deviceName: "Tablet" });
		expect(phone.deviceStore.connection).toBeNull();
		expect(account.folders.get("My vault")?.get(".obsync/devices/phone-1.json")).toBeUndefined();
	});

	it("connects anyway when the user asks to", async () => {
		const { service, account } = await remoteWithMark(0);
		const phone = createConnectingDevice(service, "phone");

		const outcome = await (await authorize(phone, account)).useFolder("My vault", "Phone", { evenDuringFirstSync: true });

		expect(outcome).toEqual({ kind: "connected" });
		expect(phone.deviceStore.connection?.device).toEqual({ id: "phone-1", name: "Phone" });
	});

	it("takes a mark older than six hours for one left by a First sync that never finished", async () => {
		const { service, account } = await remoteWithMark(1_000);
		const phone = createConnectingDevice(service, "phone");
		phone.clock.advance(1_000 + MARK_TIMEOUT_MS + 1);

		const outcome = await (await authorize(phone, account)).useFolder("My vault", "Phone");

		expect(outcome).toEqual({ kind: "connected" });
	});
});

describe("connecting a device", () => {
	it("creates a Remote named as asked and leaves the device Connected to it", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");

		const outcome = await (await authorize(laptop, account)).createRemote("My vault", "Laptop");

		expect(outcome).toEqual({ kind: "connected" });
		expect(account.folders.has("My vault")).toBe(true);
		expect(laptop.deviceStore.connection).toEqual({
			accountId: "account-1",
			remoteRoot: "My vault",
			device: { id: "laptop-1", name: "Laptop" },
		});
		expect(laptop.secretStore.getSecret("obsync-fake-service")).not.toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "connected" });
	});

	it("writes the shared Remote settings at their defaults when creating a Remote", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");

		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");

		expect(readJson(account.folders.get("My vault"), ".obsync/settings.json")).toEqual({
			formatVersion: 1,
			namePolicy: "skipAndReport",
			textExtensions: ["md", "txt"],
			ignoreList: [],
			sizeCeilingBytes: 104857600,
		});
	});

	it("registers the device in the Metadata folder when creating a Remote", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");

		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");

		expect(readJson(account.folders.get("My vault"), ".obsync/devices/laptop-1.json")).toEqual({
			formatVersion: 1,
			deviceId: "laptop-1",
			deviceName: "Laptop",
		});
	});

	it("lists the App Folder's subfolders, marking those that already hold a Remote", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		await (await authorize(createConnectingDevice(service, "laptop"), account)).createRemote("My vault", "Laptop");
		account.addFolder("Photos");

		const remotes = await authorize(createConnectingDevice(service, "phone"), account);

		expect(await remotes.list()).toEqual(
			expect.arrayContaining([
				{ root: "My vault", name: "My vault", isRemote: true },
				{ root: "Photos", name: "Photos", isRemote: false },
			]),
		);
	});

	it("joins an existing Remote, keeping its settings and adding its own record", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		await (await authorize(createConnectingDevice(service, "laptop"), account)).createRemote("My vault", "Laptop");
		const vault = account.folders.get("My vault");
		const settingsBefore = vault?.get(".obsync/settings.json");
		const phone = createConnectingDevice(service, "phone");

		await (await authorize(phone, account)).useFolder("My vault", "Phone");

		expect(vault?.get(".obsync/settings.json")).toBe(settingsBefore);
		expect(readJson(vault, ".obsync/devices/laptop-1.json")).toMatchObject({ deviceName: "Laptop" });
		expect(readJson(vault, ".obsync/devices/phone-1.json")).toMatchObject({ deviceName: "Phone" });
		expect(phone.deviceStore.connection).toMatchObject({ remoteRoot: "My vault", device: { id: "phone-1" } });
		expect(phone.ui.lastStatus).toEqual({ state: "connected" });
	});

	it("turns a plain subfolder into a Remote when it is chosen", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		account.addFolder("Notes");
		const laptop = createConnectingDevice(service, "laptop");

		await (await authorize(laptop, account)).useFolder("Notes", "Laptop");

		const notes = account.folders.get("Notes");
		expect(readJson(notes, ".obsync/settings.json")).toMatchObject({ formatVersion: 1, namePolicy: "skipAndReport" });
		expect(readJson(notes, ".obsync/devices/laptop-1.json")).toMatchObject({ deviceName: "Laptop" });
	});

	it("keeps one settings file when two devices set up the same folder at once", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		account.addFolder("Notes");
		const laptop = await authorize(createConnectingDevice(service, "laptop"), account);
		const phone = await authorize(createConnectingDevice(service, "phone"), account);

		await Promise.all([laptop.useFolder("Notes", "Laptop"), phone.useFolder("Notes", "Phone")]);

		const notes = account.folders.get("Notes");
		expect(readJson(notes, ".obsync/settings.json")).toMatchObject({ formatVersion: 1 });
		expect(readJson(notes, ".obsync/devices/laptop-1.json")).toMatchObject({ deviceName: "Laptop" });
		expect(readJson(notes, ".obsync/devices/phone-1.json")).toMatchObject({ deviceName: "Phone" });
	});
	it("refuses to create a Remote under a taken name, storing nothing", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		account.addFolder("My vault");
		const laptop = createConnectingDevice(service, "laptop");

		const outcome = await (await authorize(laptop, account)).createRemote("My vault", "Laptop");

		expect(outcome).toEqual({ kind: "nameTaken" });
		expect(account.folders.get("My vault")?.get(".obsync")).toBeUndefined();
		expect(laptop.deviceStore.connection).toBeNull();
	});

	it("refuses a Remote name holding a slash, creating no folder", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");

		const outcome = await (await authorize(laptop, account)).createRemote("Work/Notes", "Laptop");

		expect(outcome).toEqual({ kind: "invalidName" });
		expect(account.folders.size).toBe(0);
		expect(laptop.deviceStore.connection).toBeNull();
	});

	it("offers the folder a failed Remote creation left behind, and connects to it", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		const remotes = await authorize(laptop, account);
		laptop.connectStep.failNext("write", { category: "transient" });

		await expect(remotes.createRemote("My vault", "Laptop")).rejects.toMatchObject({
			failure: { category: "transient" },
		});
		expect(await remotes.list()).toEqual([{ root: "My vault", name: "My vault", isRemote: true }]);
		expect(laptop.deviceStore.connection).toBeNull();

		await remotes.useFolder("My vault", "Laptop");

		expect(readJson(account.folders.get("My vault"), ".obsync/devices/laptop-2.json")).toMatchObject({
			deviceName: "Laptop",
		});
		expect(laptop.deviceStore.connection).toMatchObject({ remoteRoot: "My vault" });
	});
});

describe("refusing a provider without conditional writes", () => {
	it("refuses a chosen folder, writing nothing there and storing no Connection", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1", { conditionalWrite: false });
		account.addFolder("Notes");
		const laptop = createConnectingDevice(service, "laptop");

		const outcome = await (await authorize(laptop, account)).useFolder("Notes", "Laptop");

		expect(outcome).toEqual({ kind: "unsupportedProvider" });
		expect(account.folders.get("Notes")?.list()).toEqual([]);
		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.secretStore.getSecret("obsync-fake-service")).toBeNull();
	});

	it("refuses a new Remote before writing its Metadata folder", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1", { conditionalWrite: false });
		const laptop = createConnectingDevice(service, "laptop");

		const outcome = await (await authorize(laptop, account)).createRemote("My vault", "Laptop");

		expect(outcome).toEqual({ kind: "unsupportedProvider" });
		expect(account.folders.get("My vault")?.get(".obsync")).toBeUndefined();
		expect(laptop.deviceStore.connection).toBeNull();
	});

	it("connects to a folder whose provider reports conditional writes", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		account.addFolder("Notes");
		const laptop = createConnectingDevice(service, "laptop");

		expect(await (await authorize(laptop, account)).useFolder("Notes", "Laptop")).toEqual({ kind: "connected" });
	});
});

describe("logging in", () => {
	it("asks for a new login when the pasted code is refused, storing nothing", async () => {
		const service = new FakeService();
		service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		const pending = await createConnectionService(laptop.ports).startAuthorization();

		expect(await pending.submitCode("expired-code")).toEqual({ kind: "codeRejected" });
		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.secretStore.getSecret("obsync-fake-service")).toBeNull();
	});

	it("refuses a login to another account while connected, keeping the Connection and secret", async () => {
		const service = new FakeService();
		const first = service.addAccount("account-1");
		const second = service.addAccount("account-2");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, first)).createRemote("My vault", "Laptop");
		const connection = laptop.deviceStore.connection;
		const secret = laptop.secretStore.getSecret("obsync-fake-service");

		expect(await logIn(laptop, second)).toEqual({ kind: "otherAccount" });
		expect(laptop.deviceStore.connection).toBe(connection);
		expect(laptop.secretStore.getSecret("obsync-fake-service")).toBe(secret);
	});

	it("keeps the Connection and takes the new secret on a login to the same account", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		const connection = laptop.deviceStore.connection;
		const oldSecret = laptop.secretStore.getSecret("obsync-fake-service");

		expect(await logIn(laptop, account)).toEqual({ kind: "reconnected" });
		expect(laptop.deviceStore.connection).toBe(connection);
		expect(laptop.secretStore.getSecret("obsync-fake-service")).not.toBe(oldSecret);
		expect(laptop.ui.lastStatus).toEqual({ state: "connected" });
	});
});

describe("disconnecting", () => {
	it("revokes the login and clears this device's secret and Connection", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		const secret = laptop.secretStore.getSecret("obsync-fake-service") ?? "";

		const outcome = await createConnectionService(laptop.ports).disconnect();

		expect(outcome).toEqual({ kind: "disconnected" });
		expect(() => service.accountOf(secret)).toThrow();
		expect(laptop.secretStore.getSecret("obsync-fake-service")).toBeNull();
		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});

	it("clears the skipped-files list shown for the Remote it leaves", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		laptop.ui.showSkipped([{ path: "big.pdf", reason: "tooLarge" }]);

		await createConnectionService(laptop.ports).disconnect();

		expect(laptop.ui.lastSkipped).toEqual([]);
	});

	it("clears the conflicts list shown for the Remote it leaves", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		laptop.ui.showConflicts({ conflicted: ["note.md"], copies: [], configuration: [] });

		await createConnectionService(laptop.ports).disconnect();

		expect(laptop.ui.lastConflicts).toEqual({ conflicted: [], copies: [], configuration: [] });
	});

	it("clears local state even when the revoke cannot reach the service, saying so", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		const secret = laptop.secretStore.getSecret("obsync-fake-service") ?? "";
		laptop.connectStep.failNext("revoke", { category: "transient" });

		const outcome = await createConnectionService(laptop.ports).disconnect();

		expect(outcome).toEqual({ kind: "revokeFailed" });
		expect(service.accountOf(secret)).toBe(account);
		expect(laptop.secretStore.getSecret("obsync-fake-service")).toBeNull();
		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});

	it("leaves the Remote and other devices untouched", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		const phone = createConnectingDevice(service, "phone");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		await (await authorize(phone, account)).useFolder("My vault", "Phone");
		const vault = account.folders.get("My vault");
		const entriesBefore = vault?.list();

		await createConnectionService(laptop.ports).disconnect();

		expect(vault?.list()).toEqual(entriesBefore);
		expect(phone.deviceStore.connection).toMatchObject({ remoteRoot: "My vault" });
		const phoneSecret = phone.secretStore.getSecret("obsync-fake-service") ?? "";
		expect(await phone.connectStep.access(phoneSecret).listRoots(".obsync")).toHaveLength(1);
	});

	it("counts a secret the service already refuses as revoked", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		service.revoke(laptop.secretStore.getSecret("obsync-fake-service") ?? "");

		const outcome = await createConnectionService(laptop.ports).disconnect();

		expect(outcome).toEqual({ kind: "disconnected" });
		expect(laptop.deviceStore.connection).toBeNull();
	});

	it("clears a device whose secret is already gone", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		laptop.secretStore.deleteSecret("obsync-fake-service");

		const outcome = await createConnectionService(laptop.ports).disconnect();

		expect(outcome).toEqual({ kind: "disconnected" });
		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});
});

describe("this device's Connection", () => {
	it("is shown as Not connected, with no device, before connecting", async () => {
		const laptop = createConnectingDevice(new FakeService(), "laptop");
		const connection = createConnectionService(laptop.ports);

		await connection.showStatus();

		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
		expect(await connection.currentDevice()).toBeNull();
	});

	it("is shown as Connected, with the device as registered, once connected", async () => {
		const service = new FakeService();
		const account = service.addAccount("account-1");
		const laptop = createConnectingDevice(service, "laptop");
		await (await authorize(laptop, account)).createRemote("My vault", "Laptop");
		const later = createConnectingDevice(service, "later");
		await later.deviceStore.saveConnection(laptop.deviceStore.connection ?? fail());
		const connection = createConnectionService(later.ports);

		await connection.showStatus();

		expect(later.ui.lastStatus).toEqual({ state: "connected" });
		expect(await connection.currentDevice()).toEqual({ id: "laptop-1", name: "Laptop" });
	});
});

/** Fails a test that reached a state it should not. */
function fail(): never {
	throw new Error("unexpected state");
}

