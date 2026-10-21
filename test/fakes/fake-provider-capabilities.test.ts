import { describe, expect, it } from "vitest";
import type { ChangeFeed, FileMove, FolderMove } from "../../src/engine/provider";
import { reported } from "../support/assertions";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { FakeRemote } from "./fake-remote";
import { readText } from "../support/provider-read";

describe("FakeProvider Capability toggles", () => {
	it("reports conditional write and nothing else by default", () => {
		const { capabilities } = new FakeRemote().openProvider();
		expect(capabilities.conditionalWrite).toBe(true);
		expect(capabilities.changeFeed).toBeUndefined();
		expect(capabilities.fileMove).toBeUndefined();
		expect(capabilities.folderMove).toBeUndefined();
	});

	it("rejects a precondition as an engine bug when conditional write is off", async () => {
		const provider = new FakeRemote({ conditionalWrite: false }).openProvider();
		expect(provider.capabilities.conditionalWrite).toBe(false);
		await expect(provider.write("note.md", bytes("a"), { kind: "absent" })).rejects.toThrow("conditional write");
		expect((await provider.list()).entries).toEqual([]);
	});

	describe("change feed", () => {
		it("reports what other devices changed since the listing's cursor", async () => {
			const remote = new FakeRemote({ changeFeed: true });
			const laptop = remote.openProvider();
			const phone = remote.openProvider();
			await laptop.write("kept.md", bytes("kept"));
			await laptop.write("gone.md", bytes("gone"));
			const { cursor } = await laptop.list();
			const added = await phone.write("added.md", bytes("added"));
			await phone.delete("gone.md");
			const batch = await reported<ChangeFeed>(laptop.capabilities.changeFeed).changes(cursor ?? "");
			expect(batch.changes).toEqual([added, { kind: "deleted", path: "gone.md" }]);
		});

		it("continues from the cursor of the previous batch", async () => {
			const remote = new FakeRemote({ changeFeed: true });
			const provider = remote.openProvider();
			const feed = reported<ChangeFeed>(provider.capabilities.changeFeed);
			const { cursor } = await provider.list();
			await provider.write("one.md", bytes("1"));
			const first = await feed.changes(cursor ?? "");
			const second = await provider.write("two.md", bytes("2"));
			expect((await feed.changes(first.cursor)).changes).toEqual([second]);
		});

		it("fails an unknown cursor with cursorLost", async () => {
			const provider = new FakeRemote({ changeFeed: true }).openProvider();
			await expectFailure(reported<ChangeFeed>(provider.capabilities.changeFeed).changes("bogus"), "cursorLost");
		});

		it("reports a path recreated in another case once, as the listing names it, on a case-insensitive service", async () => {
			const remote = new FakeRemote({ changeFeed: true, nameRules: { caseInsensitive: true } });
			const provider = remote.openProvider();
			const { cursor } = await provider.list();
			await provider.write("note.md", bytes("a"));
			await provider.delete("note.md");
			const recreated = await provider.write("Note.md", bytes("b"));
			const { changes } = await reported<ChangeFeed>(provider.capabilities.changeFeed).changes(cursor ?? "");
			expect(changes).toEqual([recreated]);
			expect((await provider.list()).entries).toEqual([recreated]);
		});

		it("reports a deleted path once though it changed several times, on a case-insensitive service", async () => {
			const remote = new FakeRemote({ changeFeed: true, nameRules: { caseInsensitive: true } });
			const provider = remote.openProvider();
			const { cursor } = await provider.list();
			await provider.write("note.md", bytes("a"));
			await provider.write("NOTE.md", bytes("b"));
			await provider.delete("Note.md");
			const { changes } = await reported<ChangeFeed>(provider.capabilities.changeFeed).changes(cursor ?? "");
			expect(changes).toEqual([{ kind: "deleted", path: "note.md" }]);
		});

		it("gives no cursor in a listing without the change feed", async () => {
			const provider = new FakeRemote().openProvider();
			expect((await provider.list()).cursor).toBeUndefined();
		});
	});

	describe("stable ids", () => {
		it("lists no stable ids by default", async () => {
			const provider = new FakeRemote().openProvider();
			const written = await provider.write("note.md", bytes("a"));
			expect(written.stableId).toBeUndefined();
			expect((await provider.list()).entries[0]?.stableId).toBeUndefined();
		});

		it("gives each new entry its own id, kept when the file is overwritten and when it moves", async () => {
			const provider = new FakeRemote({ stableIds: true, fileMove: true, folderMove: true }).openProvider();
			const folder = await provider.createFolder("old");
			const first = await provider.write("old/a.md", bytes("a"));
			const other = await provider.write("b.md", bytes("b"));
			const overwritten = await provider.write("old/a.md", bytes("a2"));
			await reported<FolderMove>(provider.capabilities.folderMove).moveFolder("old", "new");
			const moved = await reported<FileMove>(provider.capabilities.fileMove).moveFile("new/a.md", "c.md");

			expect(first.stableId).toBeDefined();
			expect(other.stableId).not.toBe(first.stableId);
			expect(overwritten.stableId).toBe(first.stableId);
			expect(moved.stableId).toBe(first.stableId);
			const listed = new Map((await provider.list()).entries.map((entry) => [entry.path, entry.stableId]));
			expect(listed.get("new")).toBe(folder.stableId);
			expect(listed.get("c.md")).toBe(first.stableId);
		});

		it("gives a file deleted and written again a new id", async () => {
			const provider = new FakeRemote({ stableIds: true }).openProvider();
			const first = await provider.write("note.md", bytes("a"));
			await provider.delete("note.md");
			const second = await provider.write("note.md", bytes("a"));
			expect(second.stableId).not.toBe(first.stableId);
		});
	});

	describe("file move", () => {
		it("moves a file with its content", async () => {
			const provider = new FakeRemote({ fileMove: true }).openProvider();
			await provider.write("old.md", bytes("content"));
			const moved = await reported<FileMove>(provider.capabilities.fileMove).moveFile("old.md", "new.md");
			expect(moved).toMatchObject({ kind: "file", path: "new.md" });
			expect(await readText(provider, "new.md")).toBe("content");
			await expectFailure(provider.read("old.md"), "notFound");
		});

		it("refuses to move a file onto an occupied path, replacing nothing", async () => {
			const provider = new FakeRemote({ fileMove: true }).openProvider();
			await provider.write("old.md", bytes("mine"));
			await provider.write("new.md", bytes("theirs"));
			await expectFailure(
				reported<FileMove>(provider.capabilities.fileMove).moveFile("old.md", "new.md"),
				"preconditionFailed",
			);
			expect(await readText(provider, "new.md")).toBe("theirs");
			expect(await readText(provider, "old.md")).toBe("mine");
		});
	});

	describe("folder move", () => {
		it("moves a folder with everything inside it", async () => {
			const provider = new FakeRemote({ folderMove: true }).openProvider();
			await provider.createFolder("old");
			await provider.createFolder("old/sub");
			await provider.write("old/sub/a.md", bytes("a"));
			await reported<FolderMove>(provider.capabilities.folderMove).moveFolder("old", "new");
			const paths = (await provider.list()).entries.map((entry) => entry.path).sort();
			expect(paths).toEqual(["new", "new/sub", "new/sub/a.md"]);
			expect(await readText(provider, "new/sub/a.md")).toBe("a");
		});

		it("reports each moved entry in the change feed", async () => {
			const remote = new FakeRemote({ folderMove: true, changeFeed: true });
			const provider = remote.openProvider();
			await provider.createFolder("old");
			await provider.write("old/a.md", bytes("a"));
			const { cursor } = await provider.list();
			await reported<FolderMove>(provider.capabilities.folderMove).moveFolder("old", "new");
			const { changes } = await reported<ChangeFeed>(provider.capabilities.changeFeed).changes(cursor ?? "");
			const states = changes.map((change) => `${change.kind} ${change.path}`).sort();
			expect(states).toEqual(["deleted old", "deleted old/a.md", "file new/a.md", "folder new"]);
		});

		it("refuses to move a folder onto an occupied path, replacing nothing", async () => {
			const provider = new FakeRemote({ folderMove: true }).openProvider();
			await provider.createFolder("old");
			await provider.createFolder("new");
			await expectFailure(
				reported<FolderMove>(provider.capabilities.folderMove).moveFolder("old", "new"),
				"preconditionFailed",
			);
			expect((await provider.list()).entries).toHaveLength(2);
		});
	});
});
