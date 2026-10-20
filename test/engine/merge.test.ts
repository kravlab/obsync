import { describe, expect, it } from "vitest";
import {
	DEFAULT_REMOTE_SETTINGS,
	METADATA_FOLDER,
	SETTINGS_PATH,
	encodeSettings,
} from "../../src/engine/remote-metadata";
import { bytes } from "../support/bytes";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice } from "../fakes/test-device";
import { remoteText, syncNow, syncedPair, vaultText } from "../support/sync";


describe("shared Remote settings at the start of a sync", () => {
	it("stops before touching anything, as Sync failed, when the Remote has no settings", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		remote.remove(SETTINGS_PATH);
		await laptop.vault.write("note.md", bytes("from laptop"));

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed" });
		expect(remote.get("note.md")).toBeUndefined();
		expect(await vaultText(laptop, "note.md")).toBe("from laptop");
	});
});

describe("merging a note edited on two devices", () => {
	it("merges edits to different lines on both devices and the Remote", async () => {
		const { remote, laptop, phone } = await syncedPair("one\ntwo\nthree\n");
		await laptop.vault.write("note.md", bytes("ONE\ntwo\nthree\n"));
		await phone.vault.write("note.md", bytes("one\ntwo\nTHREE\n"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(remoteText(remote, "note.md")).toBe("ONE\ntwo\nTHREE\n");
		expect(await vaultText(phone, "note.md")).toBe("ONE\ntwo\nTHREE\n");
		expect(await vaultText(laptop, "note.md")).toBe("ONE\ntwo\nTHREE\n");
	});

	it("writes overlapping edits as a Conflict block labelled with the merging device and Remote, on both sides", async () => {
		const { remote, laptop, phone } = await syncedPair("title\nbody\n");
		await laptop.vault.write("note.md", bytes("title\nlaptop's body\n"));
		await phone.vault.write("note.md", bytes("title\nphone's body\n"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		const merged = "title\n<<<<<<< Phone\nphone's body\n=======\nlaptop's body\n>>>>>>> Remote\n";
		expect(remoteText(remote, "note.md")).toBe(merged);
		expect(await vaultText(phone, "note.md")).toBe(merged);
		expect(await vaultText(laptop, "note.md")).toBe(merged);
		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("merges the next edits against the merged result, so a resolved conflict stays resolved", async () => {
		const { remote, laptop, phone } = await syncedPair("a\nkeep\nb\nc\n");
		await laptop.vault.write("note.md", bytes("a\nkeep\nlaptop\nc\n"));
		await phone.vault.write("note.md", bytes("a\nkeep\nphone\nc\n"));
		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);
		// Resolved by hand on the laptop, while the phone edits a line further up.
		await laptop.vault.write("note.md", bytes("a\nkeep\nboth\nc\n"));
		await phone.vault.write("note.md", bytes("A\nkeep\n<<<<<<< Phone\nphone\n=======\nlaptop\n>>>>>>> Remote\nc\n"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "note.md")).toBe("A\nkeep\nboth\nc\n");
		expect(await vaultText(phone, "note.md")).toBe("A\nkeep\nboth\nc\n");
	});

	it("takes a difference only in line endings as none, writing the merge in the merging device's line endings", async () => {
		const { remote, laptop, phone } = await syncedPair("one\ntwo\n");
		await phone.vault.write("note.md", bytes("one\r\ntwo\r\n"));
		await laptop.vault.write("note.md", bytes("one\nTWO\n"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(await vaultText(phone, "note.md")).toBe("one\r\nTWO\r\n");
		expect(remoteText(remote, "note.md")).toBe("one\r\nTWO\r\n");
		// A plain download takes the Remote's bytes as they are; only a merge is written in the local style.
		expect(await vaultText(laptop, "note.md")).toBe("one\r\nTWO\r\n");
	});

	it("merges a note that still holds old markers, keeping them as plain lines", async () => {
		const old = "<<<<<<< Phone\nx\n=======\ny\n>>>>>>> Remote\n";
		const { remote, laptop, phone } = await syncedPair(`top\nkeep\n${old}`);
		await laptop.vault.write("note.md", bytes(`TOP\nkeep\n${old}`));
		await phone.vault.write("note.md", bytes(`top\nkeep\n${old}end\n`));

		await syncNow(laptop);
		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe(`TOP\nkeep\n${old}end\n`);
		expect(remoteText(remote, "note.md")).toBe(`TOP\nkeep\n${old}end\n`);
	});

	it("merges an upload another device beat in the same sync, losing neither edit", async () => {
		const { remote, laptop, phone } = await syncedPair("one\ntwo\nthree\n");
		await laptop.vault.write("note.md", bytes("ONE\ntwo\nthree\n"));
		laptop.provider.beforeNext("write", async () => {
			await phone.vault.write("note.md", bytes("one\ntwo\nTHREE\n"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		expect(remoteText(remote, "note.md")).toBe("ONE\ntwo\nTHREE\n");
		expect(await vaultText(laptop, "note.md")).toBe("ONE\ntwo\nTHREE\n");
	});
});

describe("merging without a true Base", () => {
	it("marks every differing region of a synced note without a Base, picking no side", async () => {
		const { remote, laptop, phone } = await syncedPair("one\ntwo\nthree\n");
		phone.deviceStore.bases.delete("note.md");
		await laptop.vault.write("note.md", bytes("ONE\ntwo\nthree\n"));
		await phone.vault.write("note.md", bytes("one\ntwo\nTHREE\n"));

		await syncNow(laptop);
		await syncNow(phone);

		const merged =
			"<<<<<<< Phone\none\n=======\nONE\n>>>>>>> Remote\ntwo\n<<<<<<< Phone\nTHREE\n=======\nthree\n>>>>>>> Remote\n";
		expect(await vaultText(phone, "note.md")).toBe(merged);
		expect(remoteText(remote, "note.md")).toBe(merged);
	});

	it("does not use a Base that is not the content last synced", async () => {
		const { laptop, phone } = await syncedPair("one\ntwo\n");
		phone.deviceStore.bases.set("note.md", bytes("one\nTWO\n"));
		await laptop.vault.write("note.md", bytes("one\nTWO\n"));
		await phone.vault.write("note.md", bytes("ONE\ntwo\n"));

		await syncNow(laptop);
		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toContain("<<<<<<< Phone");
	});

	it("merges a note created on both devices with different content 2-way", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("note.md", bytes("shared\nlaptop's\n"));
		await phone.vault.write("note.md", bytes("shared\nphone's\n"));

		await syncNow(laptop);
		await syncNow(phone);

		const merged = "shared\n<<<<<<< Phone\nphone's\n=======\nlaptop's\n>>>>>>> Remote\n";
		expect(await vaultText(phone, "note.md")).toBe(merged);
		expect(remoteText(remote, "note.md")).toBe(merged);
	});
});

describe("what is not merged", () => {
	it("leaves the note being typed in until the post-edit pause has passed", async () => {
		const { remote, laptop, phone } = await syncedPair("one\nkeep\ntwo\n");
		await laptop.vault.write("note.md", bytes("ONE\nkeep\ntwo\n"));
		await syncNow(laptop);
		await phone.vault.typeInto("note.md", bytes("one\nkeep\nTWO\n"));

		phone.clock.advance(1999);
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("one\nkeep\nTWO\n");
		expect(remoteText(remote, "note.md")).toBe("ONE\nkeep\ntwo\n");

		phone.clock.advance(1);
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("ONE\nkeep\nTWO\n");
		expect(remoteText(remote, "note.md")).toBe("ONE\nkeep\nTWO\n");
	});

	it("does not download into the note being typed in until the post-edit pause has passed", async () => {
		const { laptop, phone } = await syncedPair("one\n");
		await phone.vault.typeInto("note.md", bytes("one\n"));
		await laptop.vault.write("note.md", bytes("two\n"));
		await syncNow(laptop);

		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("one\n");

		phone.clock.advance(2000);
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("two\n");
	});
});


describe("edits made at the last moment", () => {
	it("does not overwrite a note edited just before a download is written into it, merging the two instead", async () => {
		const { laptop, phone } = await syncedPair("one\n");
		await laptop.vault.write("note.md", bytes("two\n"));
		await syncNow(laptop);
		phone.vault.beforeNextWrite("note.md", () => phone.vault.write("note.md", bytes("typed meanwhile\n")));

		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("<<<<<<< Phone\ntyped meanwhile\n=======\ntwo\n>>>>>>> Remote\n");
	});

	it("does not overwrite a note edited just before a merge is written into it", async () => {
		const { laptop, phone } = await syncedPair("one\nkeep\nthree\n");
		await laptop.vault.write("note.md", bytes("ONE\nkeep\nthree\n"));
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("one\nkeep\nTHREE\n"));
		phone.vault.beforeNextWrite("note.md", () => phone.vault.write("note.md", bytes("typed meanwhile\n")));

		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("typed meanwhile\n");
	});
});

describe("JSON files", () => {
	it("makes a Conflict copy of a JSON file instead of markers, even when its extension is in the text-extension list", async () => {
		const remote = new FakeRemote();
		remote.put(METADATA_FOLDER, { kind: "folder" });
		remote.put(SETTINGS_PATH, {
			kind: "file",
			data: encodeSettings({ ...DEFAULT_REMOTE_SETTINGS, textExtensions: ["md", "canvas", "json"] }),
			revision: remote.nextRevision(),
		});
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		phone.clock.advance(new Date(2026, 9, 20, 14, 30).getTime());
		await laptop.vault.write("board.canvas", bytes('{"nodes":[]}\n'));
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.write("board.canvas", bytes('{"nodes":["laptop"]}\n'));
		await phone.vault.write("board.canvas", bytes('{"nodes":["phone"]}\n'));

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "board.canvas")).toBe('{"nodes":["laptop"]}\n');
		expect(await vaultText(phone, "board.canvas")).toBe('{"nodes":["laptop"]}\n');
		expect(remoteText(remote, "board (conflict Phone 2026-10-20 1430).canvas")).toBe('{"nodes":["phone"]}\n');
	});
});
