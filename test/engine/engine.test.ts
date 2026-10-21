import { describe, expect, it, vi } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, createTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { readText } from "../support/provider-read";
import { remoteText, setSchedule, syncNow, vaultText, withStartedEngine } from "../support/sync";

/** Advances `device`'s scheduler by `ms` and waits for any triggered sync to settle. */
async function advance(device: TestDevice, ms: number): Promise<void> {
	device.scheduler.advance(ms);
	await Promise.resolve();
	await vi.waitFor(() => {
		expect(device.ui.lastStatus?.state).not.toBe("syncing");
	});
}

describe("sync engine lifecycle and triggers", () => {
	it("reports Not connected on a device that has no Connection", async () => {
		const device = createTestDevice(new FakeRemote());
		await withStartedEngine(device, () => {
			expect(device.ui.statuses).toEqual([{ state: "notConnected" }]);
			return Promise.resolve();
		});
	});

	it("syncs on vault open when the device is connected", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("welcome.md", bytes("hello"));
		await syncNow(laptop);

		await withStartedEngine(phone, async () => {
			expect(await vaultText(phone, "welcome.md")).toBe("hello");
			expect(phone.ui.statuses).toEqual([{ state: "connected" }, { state: "syncing" }, { state: "synced" }]);
		});
	});

	it("runs one engine per device on a shared Remote, each with its own stores", async () => {
		const remote = new FakeRemote();
		const laptop = createTestDevice(remote);
		const phone = createTestDevice(remote);
		await withStartedEngine(laptop, () =>
			withStartedEngine(phone, async () => {
				expect(laptop.ui.statuses).toEqual([{ state: "notConnected" }]);
				expect(phone.ui.statuses).toEqual([{ state: "notConnected" }]);
				expect(laptop.vault).not.toBe(phone.vault);
				expect(laptop.deviceStore).not.toBe(phone.deviceStore);

				const connection = { accountId: "account", remoteRoot: "", device: { id: "laptop-id", name: "Laptop" } };
				const laptopProvider = await laptop.ports.providers.open(connection, "secret");
				const phoneProvider = await phone.ports.providers.open(connection, "secret");
				await laptopProvider.write("note.md", bytes("from laptop"));
				expect(await readText(phoneProvider, "note.md")).toBe("from laptop");
			}),
		);
	});

	it("debounces vault edits by the post-edit pause and does not trigger on its own downloads", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		setSchedule(laptop, 3, 600);
		setSchedule(phone, 2, 600);
		await withStartedEngine(laptop, async () => {
			await laptop.vault.write("note.md", bytes("first"));
			await advance(laptop, 2_000);
			// Second edit before the 3 s pause ends resets the timer.
			await laptop.vault.write("note.md", bytes("second"));
			await advance(laptop, 2_000);
			expect(remote.get("note.md")).toBeUndefined();

			await advance(laptop, 1_000);
			expect(remoteText(remote, "note.md")).toBe("second");
		});
		// Downloading on phone must not schedule a post-edit sync.
		await withStartedEngine(phone, async () => {
			expect(await vaultText(phone, "note.md")).toBe("second");
			const statusesAfterOpen = phone.ui.statuses.length;
			await advance(phone, 5_000);
			expect(phone.ui.statuses).toHaveLength(statusesAfterOpen);
		});
	});

	it("schedules a follow-up sync when an open note was skipped during the post-edit pause", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		setSchedule(phone, 4, 600);
		await laptop.vault.write("note.md", bytes("line 1\nline 2"));
		await syncNow(laptop);
		await withStartedEngine(phone, async (engine) => {
			await laptop.vault.write("note.md", bytes("line 1\nline 2\nfrom laptop"));
			await syncNow(laptop);

			// User types on phone, then a manual sync runs 1 s later (3 s of post-edit pause left).
			await phone.vault.typeInto("note.md", bytes("from phone\nline 1\nline 2"));
			phone.clock.advance(1_000);
			await engine.sync();
			expect(await vaultText(phone, "note.md")).toBe("from phone\nline 1\nline 2");

			// When the remaining 3 s of the post-edit pause elapse, the scheduled follow-up merges it.
			await advance(phone, 3_000);
			expect(await vaultText(phone, "note.md")).toBe("from phone\nline 1\nline 2\nfrom laptop");
		});
	});

	it("polls on the configured interval until stopped", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		setSchedule(phone, 2, 30);
		await withStartedEngine(phone, async () => {
			await laptop.vault.write("polled.md", bytes("arrived"));
			await syncNow(laptop);

			await advance(phone, 29_000);
			expect(await phone.vault.stat("polled.md")).toBeNull();
			await advance(phone, 1_000);
			expect(await vaultText(phone, "polled.md")).toBe("arrived");
		});
		await laptop.vault.write("after-stop.md", bytes("later"));
		await syncNow(laptop);
		await advance(phone, 60_000);
		expect(await phone.vault.stat("after-stop.md")).toBeNull();
	});

	it("collapses multiple triggers during a sync into one follow-up sync, honouring reconcile", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("first.md", bytes("1"));
		const engine = createSyncEngine(laptop.ports);
		await engine.sync();

		await laptop.vault.write("second.md", bytes("2"));
		let followUpOne!: Promise<void>;
		let followUpTwo!: Promise<void>;
		let followUpReconcile!: Promise<void>;
		laptop.provider.beforeNext("write", async () => {
			await laptop.vault.write("third.md", bytes("3"));
			followUpOne = engine.sync();
			followUpTwo = engine.sync();
			followUpReconcile = engine.reconcile();
		});
		const listSpy = vi.spyOn(laptop.provider, "list");

		await engine.sync();
		await Promise.all([followUpOne, followUpTwo, followUpReconcile]);

		expect(remoteText(remote, "second.md")).toBe("2");
		expect(remoteText(remote, "third.md")).toBe("3");
		// The first sync used changes(); the one collapsed follow-up used list() for reconcile.
		expect(listSpy).toHaveBeenCalledOnce();
	});

	it("shows Offline on a transient failure, backs off exponentially, and recovers on a trigger", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		setSchedule(laptop, 2, 600);
		await laptop.vault.write("note.md", bytes("offline note"));
		const engine = createSyncEngine(laptop.ports);

		laptop.provider.failNext("list", { category: "transient" });
		laptop.provider.failNext("list", { category: "transient" });
		await engine.sync();
		expect(laptop.ui.lastStatus).toEqual({ state: "offline" });

		// First retry is at 5 s.
		await advance(laptop, 4_900);
		expect(remote.get("note.md")).toBeUndefined();
		await advance(laptop, 100);
		expect(laptop.ui.lastStatus).toEqual({ state: "offline" });

		// Second retry is at 10 s.
		await advance(laptop, 9_900);
		expect(remote.get("note.md")).toBeUndefined();
		await advance(laptop, 100);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("offline note");

		// Next transient failure starts backoff at 5 s again, and a direct trigger cancels the wait.
		await laptop.vault.write("note.md", bytes("v2"));
		laptop.provider.failNext("list", { category: "transient" });
		await engine.sync();
		expect(laptop.ui.lastStatus).toEqual({ state: "offline" });

		await engine.sync();
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("v2");
	});

	it("retries after retryAfterMs when throttled", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("throttled note"));
		const engine = createSyncEngine(laptop.ports);

		laptop.provider.failNext("list", { category: "throttled", retryAfterMs: 7_000 });
		await engine.sync();
		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed", cause: "throttled", detail: "injected throttled on list" });

		await advance(laptop, 6_900);
		expect(remote.get("note.md")).toBeUndefined();
		await advance(laptop, 100);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("throttled note");
	});
});
