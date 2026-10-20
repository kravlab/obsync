import { describe, expect, it } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { bytes } from "../support/bytes";
import { SimulatedCrash } from "../fakes/fake-provider";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice } from "../fakes/test-device";
import { rejection } from "../support/assertions";
import { mirror, remoteText, syncNow, syncedPair, vaultText } from "../support/sync";

describe("syncing new files and folders", () => {
	it("uploads a note created on one device and downloads it on another", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("note.md", bytes("from laptop"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "note.md")).toBe("from laptop");
		expect(await vaultText(phone, "note.md")).toBe("from laptop");
	});

	it("carries nested folders, empty ones included, in both directions", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.createFolder("projects");
		await laptop.vault.createFolder("projects/plans");
		await laptop.vault.write("projects/plans/q4.md", bytes("plan"));
		await laptop.vault.createFolder("empty");
		await phone.vault.createFolder("inbox");

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		for (const device of [laptop, phone]) {
			expect(await vaultText(device, "projects/plans/q4.md")).toBe("plan");
			expect(await device.vault.stat("empty")).toEqual({ kind: "folder", path: "empty" });
			expect(await device.vault.stat("inbox")).toEqual({ kind: "folder", path: "inbox" });
		}
	});

	it("unites what two devices created separately, with nothing lost", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("a.md", bytes("laptop's"));
		await phone.vault.write("b.md", bytes("phone's"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		for (const device of [laptop, phone]) {
			expect(await vaultText(device, "a.md")).toBe("laptop's");
			expect(await vaultText(device, "b.md")).toBe("phone's");
		}
	});

	it("keeps binary bytes unchanged on the way through", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("image.png", new Uint8Array([0x00, 0xff, 0x80, 0xc3, 0x28]).buffer);

		await syncNow(laptop);
		await syncNow(phone);

		expect([...new Uint8Array(await phone.vault.read("image.png"))]).toEqual([0x00, 0xff, 0x80, 0xc3, 0x28]);
	});

	it("records a file the same on both sides without copying it again", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("same.md", bytes("same"));
		await syncNow(laptop);
		await phone.vault.write("same.md", bytes("same"));
		const revision = remote.get("same.md");

		await syncNow(phone);

		expect(remote.get("same.md")).toBe(revision);
		expect(phone.deviceStore.snapshot.get("same.md")).toMatchObject({ kind: "file" });
	});

	it("does nothing on a second sync when nothing changed", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));
		await syncNow(laptop);
		const stored = remote.get("note.md");

		await syncNow(laptop);

		expect(remote.get("note.md")).toBe(stored);
	});

	it("shows Syncing… while it runs and Synced once it is done", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));

		await syncNow(laptop);

		expect(laptop.ui.statuses).toEqual([{ state: "syncing" }, { state: "synced" }]);
	});

	it("shows Not connected and touches nothing on a device without a Connection", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		laptop.deviceStore.connection = null;
		await laptop.vault.write("note.md", bytes("note"));

		await syncNow(laptop);

		expect(laptop.ui.statuses).toEqual([{ state: "notConnected" }]);
		expect(mirror(remote)).toEqual([]);
	});
});

describe("syncing changed files", () => {
	it("carries edits back and forth between two devices", async () => {
		const { remote, laptop, phone } = await syncedPair("v1");

		await laptop.vault.write("note.md", bytes("v2 from laptop"));
		await syncNow(laptop);
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("v2 from laptop");

		await phone.vault.write("note.md", bytes("v3 from phone"));
		await syncNow(phone);
		await syncNow(laptop);
		expect(await vaultText(laptop, "note.md")).toBe("v3 from phone");
		expect(remoteText(remote, "note.md")).toBe("v3 from phone");
	});

	it("uploads an edit on condition that the Remote still has the revision last synced", async () => {
		const { remote, laptop } = await syncedPair("v1");
		const synced = laptop.deviceStore.snapshot.get("note.md");
		await laptop.vault.write("note.md", bytes("v2"));

		await syncNow(laptop);

		const stored = remote.get("note.md");
		expect(stored?.kind === "file" && stored.revision).not.toBe(synced?.kind === "file" && synced.revision);
		expect(laptop.deviceStore.snapshot.get("note.md")).toEqual({
			kind: "file",
			revision: stored?.kind === "file" ? stored.revision : undefined,
			hash: expect.any(String) as unknown,
			stat: { size: 2, mtime: 1 },
		});
	});

	it("only records a new Remote revision whose content is the one already synced", async () => {
		const { remote, laptop, phone } = await syncedPair("v1");
		await laptop.provider.write("note.md", bytes("v1"));
		phone.clock.advance(1000);
		const before = await phone.vault.stat("note.md");

		await syncNow(phone);

		const stored = remote.get("note.md");
		expect(await phone.vault.stat("note.md")).toEqual(before);
		expect(phone.deviceStore.snapshot.get("note.md")).toMatchObject({
			revision: stored?.kind === "file" ? stored.revision : undefined,
		});
	});

	it("leaves a file that is not text, edited on both devices, as it is on both sides", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("photo.png", bytes("v1"));
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.write("photo.png", bytes("laptop's edit"));
		await syncNow(laptop);
		await phone.vault.write("photo.png", bytes("phone's edit"));

		await syncNow(phone);
		await syncNow(laptop);

		expect(remoteText(remote, "photo.png")).toBe("laptop's edit");
		expect(await vaultText(phone, "photo.png")).toBe("phone's edit");
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("leaves a file that is not text, created on both devices with different content, as it is on both sides", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("photo.png", bytes("laptop's"));
		await phone.vault.write("photo.png", bytes("phone's"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "photo.png")).toBe("laptop's");
		expect(await vaultText(phone, "photo.png")).toBe("phone's");
		expect(phone.deviceStore.snapshot.has("photo.png")).toBe(false);
	});

	it("matches paths without case on a case-insensitive provider, keeping each device's case", async () => {
		const remote = new FakeRemote({ nameRules: { caseInsensitive: true } });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.createFolder("Notes");
		await laptop.vault.write("Notes/a.md", bytes("laptop's"));
		await syncNow(laptop);
		await phone.vault.createFolder("notes");
		await phone.vault.write("notes/b.md", bytes("phone's"));

		await syncNow(phone);
		await syncNow(laptop);
		await syncNow(phone);

		expect(await phone.vault.stat("Notes")).toBeNull();
		expect(await vaultText(phone, "notes/a.md")).toBe("laptop's");
		expect(await vaultText(laptop, "Notes/b.md")).toBe("phone's");
		expect(mirror(remote).map((entry) => entry.path).sort()).toEqual(["Notes", "Notes/a.md", "Notes/b.md"]);
		expect([...phone.deviceStore.snapshot.keys()].sort()).toEqual(["notes", "notes/a.md", "notes/b.md"]);
	});

	it("carries an edit to a file whose case differs between devices", async () => {
		const remote = new FakeRemote({ nameRules: { caseInsensitive: true } });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("Note.md", bytes("v1"));
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("v1"));
		await syncNow(phone);

		await phone.vault.write("note.md", bytes("v2 from phone"));
		await syncNow(phone);
		await syncNow(laptop);

		expect(await vaultText(laptop, "Note.md")).toBe("v2 from phone");
		expect(await phone.vault.stat("Note.md")).toBeNull();
	});

	it("leaves deletions on either side unapplied", async () => {
		const { remote, laptop, phone } = await syncedPair("v1");
		await laptop.vault.trash("note.md");
		await syncNow(laptop);
		expect(remoteText(remote, "note.md")).toBe("v1");
		expect(await laptop.vault.stat("note.md")).toBeNull();

		remote.remove("note.md");
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("v1");
	});
});

describe("what a sync leaves out", () => {
	it("never downloads the Metadata folder", async () => {
		const remote = new FakeRemote();
		const setup = remote.openProvider();
		await setup.createFolder(".obsync");
		await setup.write(".obsync/settings.json", bytes("{}"));
		const phone = connectTestDevice(remote, "Phone");

		await syncNow(phone);

		expect(await phone.vault.stat(".obsync")).toBeNull();
		expect(await phone.vault.stat(".obsync/settings.json")).toBeNull();
	});

	it("never uploads the configuration folder", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.createFolder(laptop.vault.configDir);
		await laptop.vault.write(`${laptop.vault.configDir}/app.json`, bytes("{}"));
		await laptop.vault.write("note.md", bytes("note"));

		await syncNow(laptop);

		expect(mirror(remote).map((entry) => entry.path)).toEqual(["note.md"]);
	});

	it("leaves vault entries below a Remote file alone and syncs the rest", async () => {
		const remote = new FakeRemote();
		await remote.openProvider().write("Notes", bytes("a file on the Remote"));
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.createFolder("Notes");
		await laptop.vault.createFolder("Notes/sub");
		await laptop.vault.write("Notes/sub/a.md", bytes("a"));
		await laptop.vault.write("other.md", bytes("other"));

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "Notes")).toBe("a file on the Remote");
		expect(remoteText(remote, "other.md")).toBe("other");
		expect(await vaultText(laptop, "Notes/sub/a.md")).toBe("a");
	});

	it("leaves Remote entries below a vault file alone and syncs the rest", async () => {
		const remote = new FakeRemote();
		const setup = remote.openProvider();
		await setup.createFolder("Notes");
		await setup.createFolder("Notes/sub");
		await setup.write("Notes/sub/a.md", bytes("a"));
		await setup.write("other.md", bytes("other"));
		const phone = connectTestDevice(remote, "Phone");
		await phone.vault.write("Notes", bytes("a file in the vault"));

		await syncNow(phone);

		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(await vaultText(phone, "Notes")).toBe("a file in the vault");
		expect(await vaultText(phone, "other.md")).toBe("other");
		expect(remoteText(remote, "Notes/sub/a.md")).toBe("a");
	});

	it("leaves vault paths that differ only by case alone on a case-insensitive provider", async () => {
		const remote = new FakeRemote({ nameRules: { caseInsensitive: true } });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("a.md", bytes("lower"));
		await laptop.vault.write("A.md", bytes("upper"));
		await laptop.vault.write("other.md", bytes("other"));

		await syncNow(laptop);

		expect(mirror(remote).map((entry) => entry.path)).toEqual(["other.md"]);
		expect([...laptop.deviceStore.snapshot.keys()]).toEqual(["other.md"]);
	});

	it("never downloads into the configuration folder", async () => {
		const remote = new FakeRemote();
		const phone = connectTestDevice(remote, "Phone");
		const setup = remote.openProvider();
		await setup.createFolder(phone.vault.configDir);
		await setup.write(`${phone.vault.configDir}/app.json`, bytes("{}"));

		await syncNow(phone);

		expect(await phone.vault.stat(`${phone.vault.configDir}/app.json`)).toBeNull();
		expect(phone.deviceStore.snapshot.size).toBe(0);
	});
});

describe("concurrent changes and interruptions", () => {
	it("loses neither edit when another device uploads first, between listing and writing", async () => {
		const { remote, laptop, phone } = await syncedPair("v1");
		await laptop.vault.write("note.md", bytes("laptop's edit"));
		laptop.provider.beforeNext("write", async () => {
			await phone.vault.write("note.md", bytes("phone's edit"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		const merged = "<<<<<<< Laptop\nlaptop's edit\n=======\nphone's edit\n>>>>>>> Remote\n";
		expect(remoteText(remote, "note.md")).toBe(merged);
		expect(await vaultText(laptop, "note.md")).toBe(merged);
	});

	it("does not overwrite a vault file edited while its Remote version downloads, merging the two instead", async () => {
		const { laptop, phone } = await syncedPair("v1");
		await laptop.vault.write("note.md", bytes("v2 from laptop"));
		await syncNow(laptop);
		phone.provider.beforeNextRead("note.md", () => phone.vault.write("note.md", bytes("typed meanwhile")));

		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe(
			"<<<<<<< Phone\ntyped meanwhile\n=======\nv2 from laptop\n>>>>>>> Remote\n",
		);
	});

	it("completes on the next sync what a crash cut off, with nothing lost or doubled", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		for (const name of ["a.md", "b.md", "c.md"]) await laptop.vault.write(name, bytes(`text of ${name}`));
		laptop.provider.crashAfter(3);

		expect(await rejection(syncNow(laptop))).toBeInstanceOf(SimulatedCrash);
		await syncNow(laptop);

		expect(mirror(remote).map((entry) => entry.path).sort()).toEqual(["a.md", "b.md", "c.md"]);
		for (const name of ["a.md", "b.md", "c.md"]) expect(remoteText(remote, name)).toBe(`text of ${name}`);
		expect([...laptop.deviceStore.snapshot.keys()].sort()).toEqual(["a.md", "b.md", "c.md"]);
	});

	it("keeps syncing a file whose edit was uploaded just before a crash", async () => {
		const { laptop, phone } = await syncedPair("v1");
		await laptop.vault.write("note.md", bytes("v2"));
		laptop.provider.crashAfter(2);
		expect(await rejection(syncNow(laptop))).toBeInstanceOf(SimulatedCrash);

		await syncNow(laptop);
		await laptop.vault.write("note.md", bytes("v3"));
		await syncNow(laptop);
		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("v3");
	});

	it("keeps syncing a file that two devices edited the same way", async () => {
		const { laptop, phone } = await syncedPair("v1");
		await laptop.vault.write("note.md", bytes("same edit"));
		await phone.vault.write("note.md", bytes("same edit"));
		await syncNow(laptop);
		await syncNow(phone);

		await phone.vault.write("note.md", bytes("phone's next edit"));
		await syncNow(phone);
		await syncNow(laptop);

		expect(await vaultText(laptop, "note.md")).toBe("phone's next edit");
	});
});

describe("sync status and runs", () => {
	it("refuses to sync with a provider that does not report conditional writes, changing nothing", async () => {
		const remote = new FakeRemote({ conditionalWrite: false });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));

		await syncNow(laptop);

		expect(laptop.ui.statuses).toEqual([{ state: "syncing" }, { state: "syncFailed" }]);
		expect(mirror(remote)).toEqual([]);
	});

	it("shows Offline when the Remote cannot be reached, Sync failed on a permanent failure, and Synced once it recovers", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		laptop.provider.failNext("list", { category: "transient" });

		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "offline" });

		laptop.provider.failNext("list", { category: "permanent" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed" });

		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("shows Sync failed when the login secret is missing", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		laptop.secretStore.deleteSecret("obsync-fake-service");

		await syncNow(laptop);

		expect(laptop.ui.statuses).toEqual([{ state: "syncing" }, { state: "syncFailed" }]);
	});

	it("joins a sync already running instead of starting a second one", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));
		const engine = createSyncEngine(laptop.ports);

		await Promise.all([engine.sync(), engine.sync()]);

		expect(laptop.ui.statuses).toEqual([{ state: "syncing" }, { state: "synced" }]);
	});
});
