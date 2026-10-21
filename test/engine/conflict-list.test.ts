import { describe, expect, it, vi } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { syncNow, syncedPair } from "../support/sync";

/** 2026-10-20 14:30 on the test machine's own clock, the local time a Conflict copy is named after. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30).getTime();

/**
 * A laptop and a phone whose overlapping edits of `note.md` the phone
 * merged with a Conflict block, and the laptop downloaded.
 */
async function conflictedPair(): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const pair = await syncedPair("title\nbody\n");
	await pair.laptop.vault.write("note.md", bytes("title\nlaptop's body\n"));
	await pair.phone.vault.write("note.md", bytes("title\nphone's body\n"));
	await syncNow(pair.laptop);
	await syncNow(pair.phone);
	await syncNow(pair.laptop);
	return pair;
}

describe("the conflicts list", () => {
	it("lists a note with Conflict blocks on the device that merged it and on the one that downloaded it", async () => {
		const { laptop, phone } = await conflictedPair();

		expect(phone.ui.lastConflicts).toEqual({ conflicted: ["note.md"], copies: [], configuration: [] });
		expect(laptop.ui.lastConflicts).toEqual({ conflicted: ["note.md"], copies: [], configuration: [] });
	});

	it("drops the note once its blocks are resolved and synced", async () => {
		const { laptop, phone } = await conflictedPair();
		await phone.vault.write("note.md", bytes("title\nboth bodies\n"));

		await syncNow(phone);
		await syncNow(laptop);

		expect(phone.ui.lastConflicts?.conflicted).toEqual([]);
		expect(laptop.ui.lastConflicts?.conflicted).toEqual([]);
	});

	it("keeps the note listed under its new name after a rename", async () => {
		const { laptop, phone } = await conflictedPair();
		await phone.vault.rename("note.md", "renamed.md");

		await syncNow(phone);
		await syncNow(laptop);

		expect(phone.ui.lastConflicts?.conflicted).toEqual(["renamed.md"]);
		expect(laptop.ui.lastConflicts?.conflicted).toEqual(["renamed.md"]);
	});

	it("lists a Conflict copy on every device, until it is deleted", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		phone.clock.advance(AFTERNOON);
		await laptop.vault.write("Photo.png", bytes("original"));
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await phone.vault.write("Photo.png", bytes("phone's photo"));
		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		const copy = "Photo (conflict Phone 2026-10-20 1430).png";
		expect(phone.ui.lastConflicts).toEqual({ conflicted: [], copies: [copy], configuration: [] });
		expect(laptop.ui.lastConflicts).toEqual({ conflicted: [], copies: [copy], configuration: [] });

		await laptop.vault.trash(copy);
		await syncNow(laptop);
		expect(laptop.ui.lastConflicts?.copies).toEqual([]);
	});

	it("shows the conflicts the device already knows when the engine starts, even if the first sync fails", async () => {
		const { phone } = await conflictedPair();
		phone.ui.conflictLists.length = 0;
		phone.provider.failNext("list", { category: "transient" });

		const started = createSyncEngine(phone.ports).start();
		await started.opened;
		started.stop();

		expect(phone.ui.lastStatus).toEqual({ state: "offline" });
		expect(phone.ui.lastConflicts).toEqual({ conflicted: ["note.md"], copies: [], configuration: [] });
	});

	it("still runs the vault-open sync when the known conflicts cannot be read", async () => {
		const { remote, phone } = await conflictedPair();
		await phone.vault.write("other.md", bytes("new note"));
		const list = phone.configurationConflicts.list.bind(phone.configurationConflicts);
		let calls = 0;
		phone.configurationConflicts.list = () => {
			calls += 1;
			return calls === 1 ? Promise.reject(new Error("kept versions unreadable")) : list();
		};

		const started = createSyncEngine(phone.ports).start();
		await expect(started.opened).rejects.toThrow("kept versions unreadable");
		started.stop();

		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(remote.get("other.md")).toBeDefined();
	});

	it("does not let the conflicts known at start replace those a sync reported since", async () => {
		const { laptop, phone } = await conflictedPair();
		await phone.vault.write("note.md", bytes("title\nresolved\n"));
		const list = phone.configurationConflicts.list.bind(phone.configurationConflicts);
		let releaseStartReport: () => void = () => undefined;
		let calls = 0;
		// The report at start is held back until the vault-open sync has reported its own.
		phone.configurationConflicts.list = async () => {
			calls += 1;
			if (calls === 1) await new Promise<void>((resolve) => (releaseStartReport = resolve));
			return list();
		};

		const started = createSyncEngine(phone.ports).start();
		await vi.waitFor(() => expect(phone.ui.lastStatus).toEqual({ state: "synced" }));
		releaseStartReport();
		await started.opened;
		started.stop();

		expect(phone.ui.lastConflicts?.conflicted).toEqual([]);
		expect(laptop.ui.lastConflicts?.conflicted).toEqual(["note.md"]);
	});
});
