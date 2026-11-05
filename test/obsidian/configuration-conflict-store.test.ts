import { describe, expect, it } from "vitest";
import { ObsidianConfigurationConflicts, type KeptFilesAdapter } from "../../src/obsidian/configuration-conflict-store";
import { bytes, text } from "../support/bytes";

/** The vault adapter's file operations over a map, as the plugin folder on disk. */
class MemoryAdapter implements KeptFilesAdapter {
	readonly files = new Map<string, string | ArrayBuffer>();
	readonly folders = new Set<string>();

	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path) || this.folders.has(path));
	}

	mkdir(path: string): Promise<void> {
		this.folders.add(path);
		return Promise.resolve();
	}

	read(path: string): Promise<string> {
		const stored = this.files.get(path);
		if (typeof stored !== "string") return Promise.reject(new Error(`no text file ${path}`));
		return Promise.resolve(stored);
	}

	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}

	readBinary(path: string): Promise<ArrayBuffer> {
		const stored = this.files.get(path);
		if (!(stored instanceof ArrayBuffer)) return Promise.reject(new Error(`no binary file ${path}`));
		return Promise.resolve(stored.slice(0));
	}

	writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.files.set(path, data.slice(0));
		return Promise.resolve();
	}

	remove(path: string): Promise<void> {
		if (!this.files.delete(path)) return Promise.reject(new Error(`no file ${path}`));
		return Promise.resolve();
	}

	list(path: string): Promise<{ files: string[]; folders: string[] }> {
		if (!this.folders.has(path)) return Promise.reject(new Error(`no folder ${path}`));
		const inside = (paths: Iterable<string>): string[] =>
			[...paths].filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/"));
		return Promise.resolve({ files: inside(this.files.keys()), folders: inside(this.folders) });
	}
}

const FOLDER = ".vault-config/plugins/seamsync/configuration-conflicts";

/** A store over `adapter` whose ids count up from `id-1`. */
function storeOn(adapter: MemoryAdapter): ObsidianConfigurationConflicts {
	let next = 0;
	return new ObsidianConfigurationConflicts(adapter, FOLDER, () => {
		next += 1;
		return `id-${next}`;
	});
}

describe("ObsidianConfigurationConflicts", () => {
	it("lists nothing in a plugin folder that has never kept a version", async () => {
		expect(await storeOn(new MemoryAdapter()).list()).toEqual([]);
	});

	it("keeps each version as its own two files and lists them newest first, a store opened later too", async () => {
		const adapter = new MemoryAdapter();
		const store = storeOn(adapter);
		await store.keep(".vault-config/app.json", bytes("first"), 1_000);
		await store.keep(".vault-config/app.json", bytes("second"), 2_000);
		const expected = [
			{ id: "id-2", path: ".vault-config/app.json", keptAt: 2_000 },
			{ id: "id-1", path: ".vault-config/app.json", keptAt: 1_000 },
		];
		expect(await store.list()).toEqual(expected);
		expect(await storeOn(adapter).list()).toEqual(expected);
		expect(text((await store.read("id-1"))!)).toBe("first");
		// One description and one data file per version, no shared index a cut-off write could lose.
		expect([...adapter.files.keys()].sort()).toEqual([
			`${FOLDER}/id-1`,
			`${FOLDER}/id-1.json`,
			`${FOLDER}/id-2`,
			`${FOLDER}/id-2.json`,
		]);
	});

	it("forgets a removed version and its bytes, and gives null for an id not kept", async () => {
		const adapter = new MemoryAdapter();
		const store = storeOn(adapter);
		await store.keep(".vault-config/app.json", bytes("first"), 1_000);
		await store.remove("id-1");
		await store.remove("never");
		expect(await store.list()).toEqual([]);
		expect(await store.read("id-1")).toBeNull();
		expect([...adapter.files.keys()]).toEqual([]);
	});

	it("skips only a version it cannot read, and keeping another drops none of the rest", async () => {
		const adapter = new MemoryAdapter();
		const store = storeOn(adapter);
		await store.keep(".vault-config/app.json", bytes("first"), 1_000);
		for (const [id, description] of [
			["cut-off", '{"formatVersion":1,"pa'],
			["newer", '{"formatVersion":2,"path":".vault-config/app.json","keptAt":1500}'],
			["malformed", '{"formatVersion":1,"path":7,"keptAt":1500}'],
		] as const) {
			adapter.files.set(`${FOLDER}/${id}`, bytes(id));
			adapter.files.set(`${FOLDER}/${id}.json`, description);
		}
		await store.keep(".vault-config/hotkeys.json", bytes("second"), 2_000);
		expect(await storeOn(adapter).list()).toEqual([
			{ id: "id-2", path: ".vault-config/hotkeys.json", keptAt: 2_000 },
			{ id: "id-1", path: ".vault-config/app.json", keptAt: 1_000 },
		]);
		expect(await store.read("newer")).toBeNull();
		expect(adapter.files.get(`${FOLDER}/newer.json`)).toContain('"formatVersion":2');
	});

	it("does not list a version whose bytes are not written yet", async () => {
		const adapter = new MemoryAdapter();
		adapter.folders.add(FOLDER);
		adapter.files.set(`${FOLDER}/lost.json`, '{"formatVersion":1,"path":".vault-config/app.json","keptAt":1000}');
		const store = storeOn(adapter);
		expect(await store.list()).toEqual([]);
		expect(await store.read("lost")).toBeNull();
	});
});
