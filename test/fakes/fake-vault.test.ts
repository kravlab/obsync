import { describe, expect, it } from "vitest";
import type { VaultChangeHint } from "../../src/engine/local-vault";
import { bytes, text } from "../support/bytes";
import { FakeVault } from "./fake-vault";
import { ManualClock } from "./manual-clock";

describe("FakeVault", () => {
	it("reads back what was written, with its size and the clock's time", async () => {
		const clock = new ManualClock(1_000);
		const vault = new FakeVault({ clock });
		await vault.write("note.md", bytes("hello"));
		expect(text(await vault.read("note.md"))).toBe("hello");
		expect(await vault.stat("note.md")).toEqual({ kind: "file", path: "note.md", size: 5, mtime: 1_000 });
	});

	it("updates the modification time when a file is rewritten", async () => {
		const clock = new ManualClock(1_000);
		const vault = new FakeVault({ clock });
		await vault.write("note.md", bytes("one"));
		clock.advance(500);
		await vault.write("note.md", bytes("two"));
		expect(await vault.stat("note.md")).toMatchObject({ mtime: 1_500 });
	});

	it("advances the modification time when a file is rewritten without the clock moving", async () => {
		const clock = new ManualClock(1_000);
		const vault = new FakeVault({ clock });
		await vault.write("note.md", bytes("one"));
		await vault.write("note.md", bytes("two"));
		expect(await vault.stat("note.md")).toMatchObject({ mtime: 1_001 });
	});

	it("returns null from stat for a missing path", async () => {
		expect(await new FakeVault().stat("missing.md")).toBeNull();
	});

	it("fails reading a missing file", async () => {
		await expect(new FakeVault().read("missing.md")).rejects.toThrow("missing.md");
	});

	it("fails writing into a folder that does not exist", async () => {
		await expect(new FakeVault().write("notes/a.md", bytes("a"))).rejects.toThrow("notes");
	});

	it("lists visible entries and the configuration folder, but no other dot-paths", async () => {
		const vault = new FakeVault();
		await vault.createFolder("notes");
		await vault.write("notes/a.md", bytes("a"));
		await vault.createFolder(".vault-config");
		await vault.write(".vault-config/app.json", bytes("{}"));
		await vault.createFolder(".git");
		await vault.write(".git/HEAD", bytes("ref"));
		await vault.write("notes/.DS_Store", bytes("x"));
		const paths = (await vault.list()).map((entry) => entry.path).sort();
		expect(paths).toEqual([".vault-config", ".vault-config/app.json", "notes", "notes/a.md"]);
	});

	it("removes a trashed entry", async () => {
		const vault = new FakeVault();
		await vault.write("note.md", bytes("a"));
		await vault.trash("note.md");
		expect(await vault.list()).toEqual([]);
	});

	it("renames a folder with everything inside it", async () => {
		const vault = new FakeVault();
		await vault.createFolder("old");
		await vault.write("old/a.md", bytes("a"));
		await vault.rename("old", "new");
		expect((await vault.list()).map((entry) => entry.path).sort()).toEqual(["new", "new/a.md"]);
		expect(text(await vault.read("new/a.md"))).toBe("a");
	});

	it("refuses to rename onto an existing path", async () => {
		const vault = new FakeVault();
		await vault.write("a.md", bytes("a"));
		await vault.write("b.md", bytes("b"));
		await expect(vault.rename("a.md", "b.md")).rejects.toThrow("b.md");
		expect(text(await vault.read("b.md"))).toBe("b");
	});

	it("reports changes to visible files as hints until unsubscribed", async () => {
		const vault = new FakeVault();
		const hints: VaultChangeHint[] = [];
		const unsubscribe = vault.onChange((hint) => hints.push(hint));
		await vault.write("a.md", bytes("1"));
		await vault.write("a.md", bytes("2"));
		await vault.rename("a.md", "b.md");
		await vault.trash("b.md");
		unsubscribe();
		await vault.write("c.md", bytes("3"));
		expect(hints).toEqual([
			{ kind: "created", path: "a.md" },
			{ kind: "modified", path: "a.md" },
			{ kind: "renamed", path: "b.md", oldPath: "a.md" },
			{ kind: "deleted", path: "b.md" },
		]);
	});

	it("reports no hints for the configuration folder", async () => {
		const vault = new FakeVault();
		const hints: VaultChangeHint[] = [];
		vault.onChange((hint) => hints.push(hint));
		await vault.createFolder(".vault-config");
		await vault.write(".vault-config/app.json", bytes("{}"));
		expect(hints).toEqual([]);
	});
});
