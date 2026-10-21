import { describe, expect, it } from "vitest";
import { createConnectionService, type AuthorizationOutcome } from "../../src/engine/connection";
import { createSyncEngine } from "../../src/engine/engine";
import { FakeRemote } from "../fakes/fake-remote";
import { FakeService, type FakeAccount } from "../fakes/fake-service";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { forgetNotices, remoteText, syncNow } from "../support/sync";

/** The Secret store id of a test device's login secret. */
const SECRET_ID = "obsync-fake-service";

/** Logs `device` in again through `service`, as the account `account` approves it. */
async function logInAgain(service: FakeService, device: TestDevice, account: FakeAccount): Promise<AuthorizationOutcome> {
	const connection = createConnectionService({
		connectStep: service.connectStep(),
		deviceStore: device.deviceStore,
		secretStore: device.secretStore,
		ui: device.ui,
		newDeviceId: () => "unused",
		clock: device.clock,
	});
	const pending = await connection.startAuthorization();
	return pending.submitCode(account.approve(pending.authorizeUrl));
}

/** A laptop and a phone that both synced `note.md` as "v1", their First syncs done and their notices forgotten. */
async function syncedDevices(): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const remote = new FakeRemote();
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	await laptop.vault.write("note.md", bytes("v1"));
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}

describe("an expired login", () => {
	it("pauses sync on this device with one Reconnect needed notice", async () => {
		const { laptop } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "reconnectNeeded" });
		expect(laptop.ui.notices).toEqual([{ kind: "reconnectNeeded" }]);
		expect(laptop.deviceStore.connection?.reconnectNeeded).toBe(true);
	});

	it("keeps the device paused on later syncs, without another notice and without uploading", async () => {
		const { remote, laptop } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });
		await syncNow(laptop);
		await laptop.vault.write("note.md", bytes("edited while paused"));

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "reconnectNeeded" });
		expect(laptop.ui.notices).toEqual([{ kind: "reconnectNeeded" }]);
		expect(remoteText(remote, "note.md")).toBe("v1");
	});

	it("leaves other devices syncing", async () => {
		const { remote, laptop, phone } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("from the phone"));

		await syncNow(phone);

		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("from the phone");
	});

	it("stays paused after a restart, showing Reconnect needed without a notice or a sync", async () => {
		const { remote, laptop } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });
		await syncNow(laptop);
		await laptop.vault.write("note.md", bytes("edited while paused"));
		forgetNotices(laptop);

		const started = createSyncEngine(laptop.ports).start();
		await started.opened;
		started.stop();

		expect(laptop.ui.lastStatus).toEqual({ state: "reconnectNeeded" });
		expect(laptop.ui.notices).toEqual([]);
		expect(remoteText(remote, "note.md")).toBe("v1");
	});

	it("pauses the same way when the login secret is missing", async () => {
		const { laptop } = await syncedDevices();
		laptop.secretStore.deleteSecret(SECRET_ID);

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "reconnectNeeded" });
		expect(laptop.ui.notices).toEqual([{ kind: "reconnectNeeded" }]);
		expect(laptop.deviceStore.connection?.reconnectNeeded).toBe(true);
	});

	it("does not pause when the secret was replaced by a new login while the refused sync ran", async () => {
		const { laptop } = await syncedDevices();
		laptop.provider.beforeNext("list", () => {
			laptop.secretStore.setSecret(SECRET_ID, "new-secret");
			return Promise.resolve();
		});
		laptop.provider.failNext("list", { category: "auth" });

		await syncNow(laptop);

		expect(laptop.ui.notices).toEqual([]);
		expect(laptop.deviceStore.connection?.reconnectNeeded).not.toBe(true);
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});
});

describe("reconnecting after an expired login", () => {
	it("clears the pause on a login to the same account, and the next sync is a normal one", async () => {
		const service = new FakeService();
		const account = service.addAccount("account");
		const { remote, laptop } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });
		await syncNow(laptop);
		await laptop.vault.write("note.md", bytes("edited while paused"));
		const previewsBefore = laptop.ui.previews.length;

		expect(await logInAgain(service, laptop, account)).toEqual({ kind: "reconnected" });
		expect(laptop.deviceStore.connection?.reconnectNeeded).not.toBe(true);
		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(laptop.ui.previews).toHaveLength(previewsBefore);
		expect(remoteText(remote, "note.md")).toBe("edited while paused");
	});

	it("keeps the pause when the login is to another account", async () => {
		const service = new FakeService();
		const other = service.addAccount("someone-else");
		const { laptop } = await syncedDevices();
		laptop.provider.failNext("list", { category: "auth" });
		await syncNow(laptop);

		expect(await logInAgain(service, laptop, other)).toEqual({ kind: "otherAccount" });
		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "reconnectNeeded" });
	});

	it("does not stay paused when the login completes while the refused sync stores its pause", async () => {
		const service = new FakeService();
		const account = service.addAccount("account");
		const { remote, laptop } = await syncedDevices();
		await laptop.vault.write("note.md", bytes("edited during the login"));
		const store = laptop.deviceStore;
		const save = store.saveConnection.bind(store);
		let loggedIn = false;
		// The login runs to its end just before the pause is stored, so it reads the Connection still unpaused.
		store.saveConnection = async (connection) => {
			if (connection.reconnectNeeded === true && !loggedIn) {
				loggedIn = true;
				expect(await logInAgain(service, laptop, account)).toEqual({ kind: "reconnected" });
			}
			await save(connection);
		};
		laptop.provider.failNext("list", { category: "auth" });

		await syncNow(laptop);

		expect(laptop.deviceStore.connection?.reconnectNeeded).not.toBe(true);
		expect(laptop.ui.notices).toEqual([]);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("edited during the login");
	});
});
