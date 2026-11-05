// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TAbstractFile, TFile, TFolder } from "./obsidian";
import { FakeApp } from "./obsidian-app";

/** `text` as UTF-8 bytes. */
function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer;
}

/** The path of the file or folder an event told; fails for anything else. */
function pathOf(entry: unknown): string {
	if (!(entry instanceof TAbstractFile)) throw new Error("not a file or folder");
	return entry.path;
}

/** The text of `data`. */
function textOf(data: ArrayBuffer): string {
	return new TextDecoder().decode(data);
}

describe("the fake vault's index", () => {
	it("lists the root first, then every file and folder, without hidden paths", () => {
		const app = new FakeApp();
		app.vault.seed("notes/a.md", "a");
		app.vault.seed(`${app.vault.configDir}/app.json`, "{}");

		const listed = app.vault.getAllLoadedFiles();

		const root = listed[0];
		expect(root instanceof TFolder && root.isRoot()).toBe(true);
		expect(
			listed
				.slice(1)
				.map((entry) => entry.path)
				.sort(),
		).toEqual(["notes", "notes/a.md"]);
	});

	it("finds a file and a folder by path, one object per path, and nothing at a hidden path", () => {
		const app = new FakeApp();
		app.vault.seed("notes/a.md", "a");
		app.vault.seed(".trash/old.md", "old");

		expect(app.vault.getAbstractFileByPath("notes")).toBeInstanceOf(TFolder);
		expect(app.vault.getFileByPath("notes/a.md")).toBe(app.vault.getAbstractFileByPath("notes/a.md"));
		expect(app.vault.getFileByPath("notes")).toBeNull();
		expect(app.vault.getAbstractFileByPath(".trash/old.md")).toBeNull();
	});

	it("names the vault", () => {
		expect(new FakeApp("Work").vault.getName()).toBe("Work");
	});

	it("seeds a binary file byte for byte, bytes that are no UTF-8 text included", async () => {
		const app = new FakeApp();
		const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xfe]);

		app.vault.seed("images/photo.png", image.buffer);

		const file = app.vault.getFileByPath("images/photo.png");
		expect(file?.stat.size).toBe(image.byteLength);
		expect([...new Uint8Array(await app.vault.adapter.readBinary("images/photo.png"))]).toEqual([...image]);
	});
});

describe("the fake vault's writes and events", () => {
	it("creates a file with its folders, telling create, and refuses one that exists", async () => {
		const app = new FakeApp();
		const created: string[] = [];
		app.vault.on("create", (file) => created.push(pathOf(file)));

		const file = await app.vault.createBinary("notes/a.md", bytes("a"));

		expect(file).toBeInstanceOf(TFile);
		expect(file.stat.size).toBe(1);
		expect(created).toEqual(["notes/a.md"]);
		await expect(app.vault.createBinary("notes/a.md", bytes("b"))).rejects.toThrow(/exists/);
	});

	it("modifies a file, updating its stat on the same object and telling modify", async () => {
		const app = new FakeApp();
		app.vault.seed("a.md", "a");
		const file = app.vault.getFileByPath("a.md");
		if (file === null) throw new Error("no file");
		const before = file.stat.mtime;
		const modified: string[] = [];
		app.vault.on("modify", (changed) => modified.push(pathOf(changed)));

		await app.vault.modifyBinary(file, bytes("longer"));

		expect(file.stat.size).toBe(6);
		expect(file.stat.mtime).toBeGreaterThan(before);
		expect(textOf(await app.vault.readBinary(file))).toBe("longer");
		expect(modified).toEqual(["a.md"]);
	});

	it("processes a file's text, writing only a change", async () => {
		const app = new FakeApp();
		app.vault.seed("a.md", "a");
		const file = app.vault.getFileByPath("a.md");
		if (file === null) throw new Error("no file");
		let modifications = 0;
		app.vault.on("modify", () => (modifications += 1));

		await app.vault.process(file, (text) => text);
		const after = await app.vault.process(file, (text) => `${text}b`);

		expect(after).toBe("ab");
		expect(modifications).toBe(1);
	});

	it("renames a folder with everything inside, keeping the objects, and tells each rename with the old path", async () => {
		const app = new FakeApp();
		app.vault.seed("old/a.md", "a");
		const file = app.vault.getFileByPath("old/a.md");
		const folder = app.vault.getAbstractFileByPath("old");
		if (folder === null) throw new Error("no folder");
		const renamed: string[] = [];
		app.vault.on("rename", (entry, oldPath) => renamed.push(`${String(oldPath)} -> ${pathOf(entry)}`));

		await app.vault.rename(folder, "new");

		expect(app.vault.getFileByPath("new/a.md")).toBe(file);
		expect(file?.path).toBe("new/a.md");
		expect(app.vault.getAbstractFileByPath("old")).toBeNull();
		expect(renamed).toEqual(["old -> new", "old/a.md -> new/a.md"]);
	});

	it("tells a renamed folder's rename first, then one for each folder and file inside in the order they were created, as Obsidian does", async () => {
		// The layout and the order of test/e2e/desktop/folder-rename-events.test.ts, seen in Obsidian.
		const app = new FakeApp();
		await app.vault.createFolder("Box");
		app.vault.seed("Box/z.md", "z");
		await app.vault.createFolder("Box/Inner");
		app.vault.seed("Box/Inner/b.md", "b");
		await app.vault.createFolder("Box/Inner/Deep");
		app.vault.seed("Box/Inner/Deep/c.md", "c");
		app.vault.seed("Box/a.md", "a");
		await app.vault.createFolder("Box/Alpha");
		app.vault.seed("Box/Inner/late.md", "late");
		app.vault.seed("Other/x.md", "x");
		const folder = app.vault.getAbstractFileByPath("Box");
		if (folder === null) throw new Error("no folder");
		const renamed: string[] = [];
		const told: unknown[] = [];
		app.vault.on("rename", (entry, oldPath) => {
			renamed.push(`${String(oldPath)} -> ${pathOf(entry)}${entry instanceof TFolder ? " (folder)" : ""}`);
			told.push(entry);
		});

		await app.vault.rename(folder, "Crate");

		expect(renamed).toEqual([
			"Box -> Crate (folder)",
			"Box/z.md -> Crate/z.md",
			"Box/Inner -> Crate/Inner (folder)",
			"Box/Inner/b.md -> Crate/Inner/b.md",
			"Box/Inner/Deep -> Crate/Inner/Deep (folder)",
			"Box/Inner/Deep/c.md -> Crate/Inner/Deep/c.md",
			"Box/a.md -> Crate/a.md",
			"Box/Alpha -> Crate/Alpha (folder)",
			"Box/Inner/late.md -> Crate/Inner/late.md",
		]);
		// Each event tells the vault's own object at the new path, as the index gives it.
		told.forEach((entry) => expect(entry).toBe(app.vault.getAbstractFileByPath(pathOf(entry))));
	});

	it("tells no rename for hidden entries inside a renamed folder, nor for a sibling whose name starts the same", async () => {
		const app = new FakeApp();
		app.vault.seed("Box/a.md", "a");
		app.vault.seed("Box/.hidden/y.md", "y");
		app.vault.seed("Box/.z", "z");
		app.vault.seed("Box2/b.md", "b");
		app.vault.seed("Boxer.md", "c");
		const folder = app.vault.getAbstractFileByPath("Box");
		if (folder === null) throw new Error("no folder");
		const renamed: string[] = [];
		app.vault.on("rename", (entry, oldPath) => renamed.push(`${String(oldPath)} -> ${pathOf(entry)}`));

		await app.vault.rename(folder, "Crate");

		expect(renamed).toEqual(["Box -> Crate", "Box/a.md -> Crate/a.md"]);
		expect(await app.vault.adapter.exists("Crate/.hidden/y.md")).toBe(true);
		expect(app.vault.getFileByPath("Box2/b.md")?.path).toBe("Box2/b.md");
		expect(app.vault.getFileByPath("Boxer.md")?.path).toBe("Boxer.md");
	});

	it("tells one rename for a renamed file", async () => {
		const app = new FakeApp();
		app.vault.seed("a.md", "a");
		const file = app.vault.getFileByPath("a.md");
		if (file === null) throw new Error("no file");
		const renamed: string[] = [];
		app.vault.on("rename", (entry, oldPath) => renamed.push(`${String(oldPath)} -> ${pathOf(entry)}`));

		await app.vault.rename(file, "b.md");

		expect(renamed).toEqual(["a.md -> b.md"]);
	});

	it("trashes a folder with everything inside through the file manager, telling delete", async () => {
		const app = new FakeApp();
		app.vault.seed("notes/a.md", "a");
		const folder = app.vault.getAbstractFileByPath("notes");
		if (folder === null) throw new Error("no folder");
		const deleted: string[] = [];
		app.vault.on("delete", (entry) => deleted.push(pathOf(entry)));

		await app.fileManager.trashFile(folder);

		expect(app.vault.getAbstractFileByPath("notes/a.md")).toBeNull();
		expect(deleted).toEqual(["notes"]);
	});

	it("stops telling a listener once its ref is removed", async () => {
		const app = new FakeApp();
		let heard = 0;
		const ref = app.vault.on("create", () => (heard += 1));

		app.vault.offref(ref);
		await app.vault.createFolder("notes");

		expect(heard).toBe(0);
	});
});

describe("the fake vault's adapter", () => {
	it("reads, writes, stats and lists hidden paths, with full paths in a listing", async () => {
		const app = new FakeApp();
		const { adapter, configDir } = app.vault;

		await adapter.write(`${configDir}/plugins/x/data.json`, "{}");

		expect(await adapter.exists(`${configDir}/plugins/x`)).toBe(true);
		expect(await adapter.read(`${configDir}/plugins/x/data.json`)).toBe("{}");
		expect(await adapter.stat(`${configDir}/plugins/x/data.json`)).toMatchObject({ type: "file", size: 2 });
		expect(await adapter.list(`${configDir}/plugins`)).toEqual({ files: [], folders: [`${configDir}/plugins/x`] });
		expect(await adapter.stat(`${configDir}/missing`)).toBeNull();
	});

	it("renames, removes and trashes through the adapter, and fails to read what is gone", async () => {
		const app = new FakeApp();
		const { adapter, configDir } = app.vault;
		await adapter.writeBinary(`${configDir}/a.bin`, bytes("a"));
		await adapter.mkdir(`${configDir}/folder/inner`);

		await adapter.rename(`${configDir}/a.bin`, `${configDir}/b.bin`);
		await adapter.trashSystem(`${configDir}/folder`);

		expect(textOf(await adapter.readBinary(`${configDir}/b.bin`))).toBe("a");
		expect(await adapter.exists(`${configDir}/folder/inner`)).toBe(false);
		await adapter.remove(`${configDir}/b.bin`);
		await expect(adapter.readBinary(`${configDir}/b.bin`)).rejects.toThrow(/ENOENT/);
	});
});

describe("the fake workspace", () => {
	it("runs layout callbacks once the layout is ready, and at once after", () => {
		const app = new FakeApp();
		const calls: string[] = [];

		app.workspace.onLayoutReady(() => calls.push("waited"));
		const before = [...calls];
		app.workspace.makeLayoutReady();
		app.workspace.onLayoutReady(() => calls.push("at once"));

		expect(before).toEqual([]);
		expect(calls).toEqual(["waited", "at once"]);
	});

	it("tells workspace listeners until their ref is removed", () => {
		const app = new FakeApp();
		const heard: unknown[] = [];
		const ref = app.workspace.on("editor-change", (...args) => heard.push(args));

		app.workspace.trigger("editor-change", "editor", "info");
		app.workspace.offref(ref);
		app.workspace.trigger("editor-change");

		expect(heard).toEqual([["editor", "info"]]);
	});

	it("opens a note in an editor holding its text, among the Markdown leaves only", async () => {
		const app = new FakeApp();
		app.vault.seed("note.md", "hello");
		const file = app.vault.getFileByPath("note.md");
		if (file === null) throw new Error("no note");
		const before = app.workspace.getLeavesOfType("markdown");

		const view = await app.workspace.openInEditor(file);

		expect(before).toEqual([]);
		expect(view.file).toBe(file);
		expect(view.editor.getValue()).toBe("hello");
		expect(app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view)).toEqual([view]);
		expect(app.workspace.getLeavesOfType("canvas")).toEqual([]);
	});

	it("tells each change of an open note's editor, and writes it to the file only on save", async () => {
		const app = new FakeApp();
		app.vault.seed("note.md", "hello");
		const file = app.vault.getFileByPath("note.md");
		if (file === null) throw new Error("no note");
		const view = await app.workspace.openInEditor(file);
		const heard: unknown[][] = [];
		app.workspace.on("editor-change", (...args) => heard.push(args));

		view.editor.replaceRange(" world", { line: 0, ch: 5 });
		const unsaved = textOf(await app.vault.readBinary(file));
		await view.save();

		expect(heard).toEqual([[view.editor, view]]);
		expect(unsaved).toBe("hello");
		expect(textOf(await app.vault.readBinary(file))).toBe("hello world");
	});
});

describe("the fake app after a restart", () => {
	it("takes over the vault's files, folders and clock, the secrets and the localStorage, as copies", async () => {
		const before = new FakeApp("My vault");
		before.vault.seed("notes/a.md", "a");
		await before.vault.adapter.write(`${before.vault.configDir}/app.json`, "{}");
		before.vault.now = 5_000;
		before.secretStorage.setSecret("token", "secret");
		before.saveLocalStorage("key", { kept: 1 });
		const after = new FakeApp("My vault");

		after.persistFrom(before);
		await before.vault.adapter.write("notes/a.md", "changed before");

		/** The bytes `app`'s vault keeps for the untouched configuration file. */
		const data = (app: FakeApp) => {
			const entry = app.vault.entries.get(`${app.vault.configDir}/app.json`);
			return entry?.kind === "file" ? entry.data : undefined;
		};
		expect(data(after)?.byteLength).toBe(2);
		expect(data(after)).not.toBe(data(before));
		expect(after.vault.getFileByPath("notes/a.md")).toBeInstanceOf(TFile);
		expect(after.vault.getAbstractFileByPath("notes")).toBeInstanceOf(TFolder);
		expect(textOf(await after.vault.adapter.readBinary("notes/a.md"))).toBe("a");
		expect(await after.vault.adapter.read(`${after.vault.configDir}/app.json`)).toBe("{}");
		expect(after.vault.now).toBe(5_000);
		expect(after.secretStorage.getSecret("token")).toBe("secret");
		expect(after.loadLocalStorage("key")).toEqual({ kept: 1 });
	});
});

describe("the fake app's storage", () => {
	it("keeps secrets by id", () => {
		const app = new FakeApp();

		app.secretStorage.setSecret("seamsync-dropbox", "token");

		expect(app.secretStorage.getSecret("seamsync-dropbox")).toBe("token");
		expect(app.secretStorage.getSecret("other")).toBeNull();
	});

	it("keeps localStorage values as JSON, so a loaded value is a copy without what JSON drops", () => {
		const app = new FakeApp();
		const stored = { kept: 1, dropped: undefined, list: [1, 2] };

		app.saveLocalStorage("key", stored);
		const loaded = app.loadLocalStorage("key") as { kept: number; list: number[] };
		loaded.list.push(3);

		expect(loaded).toEqual({ kept: 1, list: [1, 2, 3] });
		expect("dropped" in loaded).toBe(false);
		expect(app.loadLocalStorage("key")).toEqual({ kept: 1, list: [1, 2] });
	});

	it("clears a localStorage value saved as null, and gives null for a missing one", () => {
		const app = new FakeApp();
		app.saveLocalStorage("key", { kept: 1 });

		app.saveLocalStorage("key", null);

		expect(app.loadLocalStorage("key")).toBeNull();
		expect(app.loadLocalStorage("missing")).toBeNull();
	});
});
