import { describe, expect, it, vi } from "vitest";
import { parentOf } from "../../src/engine/paths";
import { bytes } from "../support/bytes";
import { FakeRemote, type FakeServiceOptions } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { forgetNotices, mirror, remoteText, syncNow, vaultText } from "../support/sync";

/** 2026-10-20 14:30 on the test machine's own clock, the local time a Conflict copy is named after. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30).getTime();

/**
 * A Remote with a laptop and a phone that both hold `path`, at the top or
 * in one folder, as `content`, synced, their clocks at AFTERNOON.
 */
async function syncedPairWith(
	path: string,
	content: ArrayBuffer,
	service: FakeServiceOptions = {},
): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const remote = new FakeRemote(service);
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	laptop.clock.advance(AFTERNOON);
	phone.clock.advance(AFTERNOON);
	const folder = parentOf(path);
	if (folder !== "") await laptop.vault.createFolder(folder);
	await laptop.vault.write(path, content);
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}

/** The paths of the Remote's mirror files, sorted. */
function remoteFiles(remote: FakeRemote): string[] {
	return mirror(remote)
		.filter((entry) => entry.kind === "file")
		.map((entry) => entry.path)
		.sort();
}

describe("Conflict copies of files that are not text", () => {
	it("keeps the Remote version under the name and this device's as a Conflict copy, on every device", async () => {
		const { remote, laptop, phone } = await syncedPairWith("photos/Photo.png", bytes("original"));
		await laptop.vault.write("photos/Photo.png", bytes("laptop's photo"));
		await phone.vault.write("photos/Photo.png", bytes("phone's photo"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		const copy = "photos/Photo (conflict Phone 2026-10-20 1430).png";
		expect(remoteFiles(remote)).toEqual([copy, "photos/Photo.png"]);
		expect(remoteText(remote, "photos/Photo.png")).toBe("laptop's photo");
		expect(remoteText(remote, copy)).toBe("phone's photo");
		for (const device of [phone, laptop]) {
			expect(await vaultText(device, "photos/Photo.png")).toBe("laptop's photo");
			expect(await vaultText(device, copy)).toBe("phone's photo");
		}
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("makes a Conflict copy of a file with a long name that the provider can still store", async () => {
		const path = `${"y".repeat(240)}.png`;
		const { remote, laptop, phone } = await syncedPairWith(path, bytes("original"), { nameRules: { maxSegmentLength: 255 } });
		await laptop.vault.write(path, bytes("laptop's photo"));
		await phone.vault.write(path, bytes("phone's photo"));

		await syncNow(laptop);
		await syncNow(phone);

		const copies = remoteFiles(remote).filter((file) => file !== path);
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(copies).toHaveLength(1);
		expect(copies[0]?.length).toBeLessThanOrEqual(255);
		expect(remoteText(remote, copies[0] ?? "")).toBe("phone's photo");
		expect((await phone.vault.list()).filter((entry) => entry.path !== path && entry.kind === "file")).toHaveLength(1);
	});

	it("makes no Conflict copy when no copy name fits the Remote, skipping the file and keeping both versions", async () => {
		// The folder leaves no room in a 60-unit path for even the shortest copy name.
		const path = `${"f".repeat(50)}/a.png`;
		const { remote, laptop, phone } = await syncedPairWith(path, bytes("original"), { nameRules: { maxPathLength: 60 } });
		await laptop.vault.write(path, bytes("laptop's photo"));
		await phone.vault.write(path, bytes("phone's photo"));
		await syncNow(laptop);

		await syncNow(phone);
		await syncNow(phone);

		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(phone.ui.lastSkipped).toEqual([{ path, reason: "nameNotRepresentable" }]);
		expect((await phone.vault.list()).filter((entry) => entry.kind === "file").map((entry) => entry.path)).toEqual([path]);
		expect(remoteFiles(remote)).toEqual([path]);
		expect(await vaultText(phone, path)).toBe("phone's photo");
		expect(remoteText(remote, path)).toBe("laptop's photo");
	});

	it("shows a notice on the device that made the Conflict copy only", async () => {
		const { laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await phone.vault.write("Photo.png", bytes("phone's photo"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(phone.ui.notices).toEqual([
			{ kind: "conflictCopyCreated", path: "Photo.png", copyPath: "Photo (conflict Phone 2026-10-20 1430).png" },
		]);
		expect(laptop.ui.notices).toEqual([]);
	});

	it("lets no device clock pick a winner: the Remote version keeps the name though this device's is newer", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("older, from laptop"));
		await syncNow(laptop);
		phone.clock.advance(24 * 60 * 60 * 1000);
		await phone.vault.write("Photo.png", bytes("newer, from phone"));

		await syncNow(phone);

		expect(remoteText(remote, "Photo.png")).toBe("older, from laptop");
		expect(remoteText(remote, "Photo (conflict Phone 2026-10-21 1430).png")).toBe("newer, from phone");
	});

	it("makes a Conflict copy of a file created on both devices with different content", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		phone.clock.advance(AFTERNOON);
		await laptop.vault.write("Scan.pdf", bytes("laptop's scan"));
		await phone.vault.write("Scan.pdf", bytes("phone's scan"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "Scan.pdf")).toBe("laptop's scan");
		expect(remoteText(remote, "Scan (conflict Phone 2026-10-20 1430).pdf")).toBe("phone's scan");
		expect(await vaultText(phone, "Scan.pdf")).toBe("laptop's scan");
	});

	it("makes a Conflict copy when another device's write beats this device's upload in the same sync", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		laptop.provider.beforeNext("write", async () => {
			await phone.vault.write("Photo.png", bytes("phone's photo"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		const copy = "Photo (conflict Laptop 2026-10-20 1430).png";
		expect(remoteText(remote, "Photo.png")).toBe("phone's photo");
		expect(remoteText(remote, copy)).toBe("laptop's photo");
		expect(await vaultText(laptop, "Photo.png")).toBe("phone's photo");
		expect(await vaultText(laptop, copy)).toBe("laptop's photo");
	});

	it("takes the same content on both devices as no conflict, after edits or when added on both", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("same photo"));
		await phone.vault.write("Photo.png", bytes("same photo"));
		await laptop.vault.write("Added.png", bytes("same new photo"));
		await phone.vault.write("Added.png", bytes("same new photo"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(remoteFiles(remote)).toEqual(["Added.png", "Photo.png"]);
		expect(phone.ui.notices).toEqual([]);
		expect(await vaultText(phone, "Photo.png")).toBe("same photo");
	});

	it("uploads an edit made here over a new Remote revision of the synced content, making no copy", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.provider.write("Photo.png", bytes("original"));
		await phone.vault.write("Photo.png", bytes("edited on phone"));

		await syncNow(phone);
		await syncNow(laptop);

		expect(remoteFiles(remote)).toEqual(["Photo.png"]);
		expect(remoteText(remote, "Photo.png")).toBe("edited on phone");
		expect(await vaultText(laptop, "Photo.png")).toBe("edited on phone");
		expect(phone.ui.notices).toEqual([]);
	});

	it("makes a Conflict copy of a note whose versions are not all UTF-8", async () => {
		const { remote, laptop, phone } = await syncedPairWith("note.md", bytes("original\n"));
		const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]).buffer;
		await laptop.vault.write("note.md", bytes("laptop's note\n"));
		await phone.vault.write("note.md", latin1);

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "note.md")).toBe("laptop's note\n");
		expect(remote.get("note (conflict Phone 2026-10-20 1430).md")).toMatchObject({ data: latin1 });
	});

	it("numbers the Conflict copy when its name is taken", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await phone.vault.write("Photo (conflict Phone 2026-10-20 1430).png", bytes("an earlier copy"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await phone.vault.write("Photo.png", bytes("phone's photo"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "Photo (conflict Phone 2026-10-20 1430).png")).toBe("an earlier copy");
		expect(remoteText(remote, "Photo (conflict Phone 2026-10-20 1430 2).png")).toBe("phone's photo");
		expect(remoteText(remote, "Photo.png")).toBe("laptop's photo");
	});

	it("numbers the Conflict copy again when its name is taken on the Remote just before the upload", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await syncNow(laptop);
		await phone.vault.write("Photo.png", bytes("phone's photo"));
		phone.provider.beforeNext("write", () => {
			remote.put("Photo (conflict Phone 2026-10-20 1430).png", {
				kind: "file",
				data: bytes("another file"),
				revision: remote.nextRevision(),
			});
			return Promise.resolve();
		});

		await syncNow(phone);

		const numbered = "Photo (conflict Phone 2026-10-20 1430 2).png";
		expect(remoteText(remote, "Photo (conflict Phone 2026-10-20 1430).png")).toBe("another file");
		expect(remoteText(remote, numbered)).toBe("phone's photo");
		expect(await vaultText(phone, numbered)).toBe("phone's photo");
		expect(await vaultText(phone, "Photo.png")).toBe("laptop's photo");
		expect(phone.ui.notices).toEqual([{ kind: "conflictCopyCreated", path: "Photo.png", copyPath: numbered }]);
	});

	it("keeps an edit made while the original takes the Remote version, as another copy on the next sync", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await syncNow(laptop);
		await phone.vault.write("Photo.png", bytes("phone's photo"));
		phone.vault.beforeNextWrite("Photo.png", () => phone.vault.write("Photo.png", bytes("phone's newer photo")));

		await syncNow(phone);

		const copy = "Photo (conflict Phone 2026-10-20 1430).png";
		expect(await vaultText(phone, copy)).toBe("phone's photo");
		expect(await vaultText(phone, "Photo.png")).toBe("phone's newer photo");

		await syncNow(phone);

		expect(remoteText(remote, "Photo.png")).toBe("laptop's photo");
		expect(remoteText(remote, copy)).toBe("phone's photo");
		expect(remoteText(remote, "Photo (conflict Phone 2026-10-20 1430 2).png")).toBe("phone's newer photo");
		expect(await vaultText(phone, "Photo.png")).toBe("laptop's photo");
	});

	it("reads the Remote version once when another device's write beats this device's upload", async () => {
		const { laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		laptop.provider.beforeNext("write", async () => {
			await phone.vault.write("Photo.png", bytes("phone's photo"));
			await syncNow(phone);
		});
		const read = vi.spyOn(laptop.provider, "read");

		await syncNow(laptop);

		expect(read.mock.calls.filter(([path]) => path === "Photo.png")).toHaveLength(1);
	});

	it("leaves a file being typed into for a later sync, making no copy yet", async () => {
		const { remote, laptop, phone } = await syncedPairWith("Photo.png", bytes("original"));
		await laptop.vault.write("Photo.png", bytes("laptop's photo"));
		await syncNow(laptop);
		await phone.vault.typeInto("Photo.png", bytes("phone's photo"));

		await syncNow(phone);

		expect(remoteFiles(remote)).toEqual(["Photo.png"]);
		expect(await vaultText(phone, "Photo.png")).toBe("phone's photo");
	});
});

describe("canvas and JSON files changed on two devices", () => {
	/** A canvas as Obsidian writes one: tab-indented JSON, one value per line. */
	const canvas = (first: string, last: string): string =>
		`{\n\t"nodes": [\n\t\t${first},\n\t\t{"id": "pad"},\n\t\t${last}\n\t]\n}\n`;

	it("applies a clean merge that parses as JSON on both sides, with no copy", async () => {
		const base = canvas('{"id": "a"}', '{"id": "b"}');
		const { remote, laptop, phone } = await syncedPairWith("Board.canvas", bytes(base));
		await laptop.vault.write("Board.canvas", bytes(canvas('{"id": "A"}', '{"id": "b"}')));
		await phone.vault.write("Board.canvas", bytes(canvas('{"id": "a"}', '{"id": "B"}')));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		const merged = canvas('{"id": "A"}', '{"id": "B"}');
		expect(remoteFiles(remote)).toEqual(["Board.canvas"]);
		expect(remoteText(remote, "Board.canvas")).toBe(merged);
		expect(await vaultText(phone, "Board.canvas")).toBe(merged);
		expect(await vaultText(laptop, "Board.canvas")).toBe(merged);
		expect(phone.ui.notices).toEqual([]);
	});

	it("makes a Conflict copy instead of applying a clean merge that is not valid JSON", async () => {
		const base = canvas('{"id": "a"}', '{"id": "b"}');
		const { remote, laptop, phone } = await syncedPairWith("Board.canvas", bytes(base));
		const broken = canvas('{"id": "a"},', '{"id": "b"}');
		await laptop.vault.write("Board.canvas", bytes(broken));
		const phones = canvas('{"id": "a"}', '{"id": "B"}');
		await phone.vault.write("Board.canvas", bytes(phones));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "Board.canvas")).toBe(broken);
		expect(remoteText(remote, "Board (conflict Phone 2026-10-20 1430).canvas")).toBe(phones);
		expect(await vaultText(phone, "Board.canvas")).toBe(broken);
	});

	it("makes a Conflict copy of overlapping JSON edits and writes no markers into either file", async () => {
		const { remote, laptop, phone } = await syncedPairWith("data.json", bytes('{\n\t"value": 1\n}\n'));
		await laptop.vault.write("data.json", bytes('{\n\t"value": 2\n}\n'));
		await phone.vault.write("data.json", bytes('{\n\t"value": 3\n}\n'));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		const copy = "data (conflict Phone 2026-10-20 1430).json";
		expect(remoteText(remote, "data.json")).toBe('{\n\t"value": 2\n}\n');
		expect(remoteText(remote, copy)).toBe('{\n\t"value": 3\n}\n');
		expect(await vaultText(laptop, copy)).toBe('{\n\t"value": 3\n}\n');
		for (const path of remoteFiles(remote)) expect(remoteText(remote, path)).not.toContain("<<<<<<<");
	});

	it("makes a Conflict copy of a JSON file created on both devices with different content", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		phone.clock.advance(AFTERNOON);
		await laptop.vault.write("data.json", bytes('{"from": "laptop"}\n'));
		await phone.vault.write("data.json", bytes('{"from": "phone"}\n'));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "data.json")).toBe('{"from": "laptop"}\n');
		expect(remoteText(remote, "data (conflict Phone 2026-10-20 1430).json")).toBe('{"from": "phone"}\n');
	});
});
