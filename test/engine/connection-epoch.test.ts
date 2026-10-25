import { describe, expect, it, vi } from "vitest";
import { NO_CONFLICTS } from "../../src/engine/conflicts";
import { createConnectionService } from "../../src/engine/connection";
import { ConnectionChanged, boundToEpoch, createConnectionEpoch } from "../../src/engine/connection-epoch";
import { createSyncEngine } from "../../src/engine/engine";
import { providerSecretId } from "../../src/engine/ports";
import { ProviderError } from "../../src/engine/provider";
import { FakeRemote } from "../fakes/fake-remote";
import { FakeService, type FakeConnectStep } from "../fakes/fake-service";
import { InMemoryDeviceStore, TEST_PROVIDER_ID, connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";

/** The connection service of `device`, sharing its stores, connect step and Connection epoch with its engine. */
function connectionOf(device: TestDevice & { readonly connectStep: FakeConnectStep }) {
	return createConnectionService({
		connectStep: device.connectStep,
		deviceStore: device.deviceStore,
		secretStore: device.secretStore,
		ui: device.ui,
		newDeviceId: () => "unused",
		clock: device.clock,
		epoch: device.epoch,
	});
}

/** A device on `remote`, connected as "Laptop", with the connect step its connection service uses. */
function laptopOn(remote: FakeRemote) {
	return Object.assign(connectTestDevice(remote, "Laptop"), { connectStep: new FakeService().connectStep() });
}

/** Connects `device` again to its Remote as the device named `name`, as a new login and Remote choice would. */
function connectAgain(device: TestDevice, name: string): void {
	device.deviceStore.connection = { accountId: "account", remoteRoot: "", device: { id: `${name}-again`, name } };
	device.secretStore.setSecret(providerSecretId(TEST_PROVIDER_ID), `${name}-secret`);
}

describe("a device store bound to a Connection epoch", () => {
	it("passes writes and reads through while the epoch is the one taken", async () => {
		const store = new InMemoryDeviceStore();
		const epoch = createConnectionEpoch();

		await boundToEpoch(store, epoch, epoch.current()).markSnapshotComplete();

		expect(store.snapshotComplete).toBe(true);
	});

	it("refuses every write once the epoch has moved on, changing nothing, and still reads", async () => {
		const store = new InMemoryDeviceStore();
		const epoch = createConnectionEpoch();
		const bound = boundToEpoch(store, epoch, epoch.current());
		epoch.advance();

		await expect(bound.markSnapshotComplete()).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(bound.saveSnapshotEntry("note.md", { kind: "folder" }, null)).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(bound.removeSnapshotEntry("note.md")).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(bound.moveSnapshotEntry("a.md", "b.md", { kind: "folder" })).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(bound.saveRemoteFeed(null)).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(
			bound.saveConnection({ accountId: "a", remoteRoot: "", device: { id: "d", name: "D" } }),
		).rejects.toBeInstanceOf(ConnectionChanged);
		await expect(bound.clear()).rejects.toBeInstanceOf(ConnectionChanged);

		expect(store.snapshotComplete).toBe(false);
		expect(store.snapshot.size).toBe(0);
		expect(store.connection).toBeNull();
		expect(await bound.hasSnapshot()).toBe(false);
	});
});

describe("Disconnect and the sync engine", () => {
	it("ends a held First sync, so the next Connection's sync asks afresh", async () => {
		const laptop = laptopOn(new FakeRemote());
		await laptop.vault.write("note.md", bytes("hello"));
		laptop.ui.firstSyncAnswers.push(null);
		const engine = createSyncEngine(laptop.ports);
		await engine.sync("automatic");
		expect(laptop.ui.lastStatus).toEqual({ state: "firstSyncWaiting" });

		await connectionOf(laptop).disconnect();
		connectAgain(laptop, "Laptop");
		await engine.sync("automatic");

		expect(laptop.ui.previews).toHaveLength(2);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("stops a sync running across it from writing this device's state, leaving the status as Disconnect set it", async () => {
		const remote = new FakeRemote();
		const laptop = laptopOn(remote);
		await laptop.vault.write("note.md", bytes("v1"));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();
		await laptop.vault.write("note.md", bytes("v2"));
		laptop.provider.beforeNext("write", async () => {
			await connectionOf(laptop).disconnect();
		});

		await engine.sync();

		expect(laptop.deviceStore.connection).toBeNull();
		expect(laptop.deviceStore.snapshot.size).toBe(0);
		expect(laptop.deviceStore.snapshotComplete).toBe(false);
		expect(laptop.deviceStore.remoteFeed).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});

	it("lets the next Connection start with a First sync, when Disconnect cut a First sync short", async () => {
		const laptop = laptopOn(new FakeRemote());
		await laptop.vault.write("note.md", bytes("v1"));
		const engine = createSyncEngine(laptop.ports);
		// The first write after the preview is the device record marking the First sync.
		laptop.provider.beforeNext("write", async () => {
			await connectionOf(laptop).disconnect();
		});
		await engine.sync();
		expect(laptop.ui.previews).toHaveLength(1);

		connectAgain(laptop, "Laptop");
		await engine.sync();

		expect(laptop.ui.previews).toHaveLength(2);
	});

	it("ends a held Deletion guard prompt, so the next Connection syncs", async () => {
		const laptop = laptopOn(new FakeRemote());
		const paths = ["a.md", "b.md", "c.md"];
		for (const path of paths) await laptop.vault.write(path, bytes(path));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();
		for (const path of paths) await laptop.vault.trash(path);
		laptop.ui.answers.push(null);
		await engine.sync("automatic");
		expect(laptop.ui.lastStatus).toEqual({ state: "deletionsOnHold" });

		await connectionOf(laptop).disconnect();
		connectAgain(laptop, "Laptop");
		await engine.sync("automatic");

		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("stops a sync started while the revoke waits for the service, before it writes anything", async () => {
		const laptop = laptopOn(new FakeRemote());
		await laptop.vault.write("note.md", bytes("v1"));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();
		await laptop.vault.write("note.md", bytes("v2"));
		const connection = connectionOf(laptop);
		let disconnecting: Promise<unknown> = Promise.resolve();
		let syncing: Promise<void> = Promise.resolve();
		const access = laptop.connectStep.access.bind(laptop.connectStep);
		vi.spyOn(laptop.connectStep, "access").mockImplementation((secret) => ({
			...access(secret),
			// A sync starts while the service is asked to revoke; it holds at its listing until Disconnect is done.
			async revoke() {
				const listing = new Promise<void>((resolve) => {
					laptop.provider.beforeNext("list", () => {
						resolve();
						return disconnecting.then(() => undefined);
					});
				});
				syncing = engine.sync("automatic");
				await Promise.race([listing, syncing]);
				throw new ProviderError({ category: "transient" }, "no response");
			},
		}));

		disconnecting = connection.disconnect();
		await disconnecting;
		await syncing;

		expect(laptop.deviceStore.snapshot.size).toBe(0);
		expect(laptop.deviceStore.snapshotComplete).toBe(false);
		expect(laptop.deviceStore.remoteFeed).toBeNull();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});

	it("shows no conflicts list after Disconnect from a sync still running", async () => {
		const laptop = laptopOn(new FakeRemote());
		await laptop.vault.write("note.md", bytes("v1"));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();
		await laptop.vault.write("note.md", bytes("v2"));
		const list = laptop.configurationConflicts.list.bind(laptop.configurationConflicts);
		let listsShownByDisconnect = 0;
		vi.spyOn(laptop.configurationConflicts, "list").mockImplementationOnce(async () => {
			await connectionOf(laptop).disconnect();
			listsShownByDisconnect = laptop.ui.conflictLists.length;
			return list();
		});

		await engine.sync();

		expect(laptop.ui.conflictLists).toHaveLength(listsShownByDisconnect);
		expect(laptop.ui.lastConflicts).toEqual(NO_CONFLICTS);
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});

	it("ends a sync whose login is refused as the epoch moves on, without an error and without pausing", async () => {
		const laptop = laptopOn(new FakeRemote());
		await laptop.vault.write("note.md", bytes("v1"));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();
		laptop.ui.notices.length = 0;
		// The first read is the shared settings, right after the Connection is read.
		laptop.provider.failNext("read", { category: "auth" });
		const load = laptop.deviceStore.loadConnection.bind(laptop.deviceStore);
		let loads = 0;
		vi.spyOn(laptop.deviceStore, "loadConnection").mockImplementation(async () => {
			loads += 1;
			const connection = await load();
			// The second read is the pause for Reconnect needed; a store may let the epoch move on meanwhile.
			if (loads === 2) laptop.epoch.advance();
			return connection;
		});

		await expect(engine.sync()).resolves.toBeUndefined();

		expect(laptop.ui.notices).toEqual([]);
		expect(laptop.deviceStore.connection?.reconnectNeeded).not.toBe(true);
	});

	it("ends a First sync whose preview is answered after Disconnect, writing nothing to the Remote", async () => {
		const remote = new FakeRemote();
		const laptop = laptopOn(remote);
		await laptop.vault.write("note.md", bytes("v1"));
		vi.spyOn(laptop.ui, "askFirstSync").mockImplementationOnce(async () => {
			await connectionOf(laptop).disconnect();
			return { differing: "merge" };
		});

		await createSyncEngine(laptop.ports).sync();

		expect(remote.get("note.md")).toBeUndefined();
		expect(laptop.ui.lastStatus).toEqual({ state: "notConnected" });
	});
});
