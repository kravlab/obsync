/**
 * A fake Obsidian `App` for tests that run the whole plugin in jsdom (spec
 * of the review fixes, item 20): a vault in memory with Obsidian's index
 * (`TFile`, `TFolder`) over everything but hidden paths, the file adapter
 * under it for every path, the vault's events, a workspace whose layout a
 * test makes ready and where it opens notes in an editor, the secret
 * storage and the per-vault localStorage. It holds what the plugin uses,
 * as Obsidian's typings document it.
 *
 * Its limit: the adapter writes the one store the index reads, so a file
 * the adapter writes at a visible path is indexed at once, with no event,
 * where Obsidian would index it later from its file watcher. The plugin
 * writes only hidden paths through the adapter.
 */
import { Editor, MarkdownView, TAbstractFile, TFile, TFolder, type FakeEventRef } from "./obsidian";

/** One stored entry, at its path. */
type Stored = { readonly kind: "file"; data: ArrayBuffer; ctime: number; mtime: number } | { readonly kind: "folder" };

/** The vault events the plugin listens to. */
type VaultEvent = "create" | "modify" | "delete" | "rename";

/** Listeners by event name, each with its arguments. */
type Listener = (...args: unknown[]) => unknown;

/** A set of listeners by event name, as Obsidian's `Events`. */
class Events {
	private readonly listeners = new Map<string, Set<Listener>>();

	/** Adds `listener` for `name`; the returned ref removes it. */
	on(name: string, listener: Listener): FakeEventRef {
		const set = this.listeners.get(name) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(name, set);
		return { off: () => set.delete(listener) };
	}

	/** Removes the listener `ref` stands for. */
	offref(ref: FakeEventRef): void {
		ref.off();
	}

	/** Calls every listener for `name` with `args`. */
	trigger(name: string, ...args: unknown[]): void {
		for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args);
	}
}

/** The parent path of `path`, "" at the root. */
function parentOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

/** Whether a segment of `path` starts with a dot, which Obsidian leaves out of its index. */
function isHidden(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

/** A copy of `data`, so callers never share bytes with the store. */
function copy(data: ArrayBuffer): ArrayBuffer {
	return data.slice(0);
}

/** The vault in memory, its index, adapter and events. */
export class FakeObsidianVault extends Events {
	/** The configuration folder, named unlike Obsidian's default, as a user may name it. */
	readonly configDir = ".vault-config";
	/** Every entry, by path. */
	readonly entries = new Map<string, Stored>();
	/** The index objects, by path, kept so each path has one object as in Obsidian. */
	private readonly indexed = new Map<string, TFile | TFolder>();
	private readonly root = new TFolder("/");
	/** The clock files are timed by, ms since the epoch; tests may move it. */
	now = 1_000;

	/** The adapter: every path, hidden ones included, with no index and no events. */
	readonly adapter = {
		exists: (path: string): Promise<boolean> => Promise.resolve(this.entries.has(path)),
		stat: (path: string): Promise<{ type: "file" | "folder"; size: number; ctime: number; mtime: number } | null> => {
			const entry = this.entries.get(path);
			if (entry === undefined) return Promise.resolve(null);
			return Promise.resolve(
				entry.kind === "file"
					? { type: "file", size: entry.data.byteLength, ctime: entry.ctime, mtime: entry.mtime }
					: { type: "folder", size: 0, ctime: 0, mtime: 0 },
			);
		},
		list: (path: string): Promise<{ files: string[]; folders: string[] }> => {
			const children = [...this.entries].filter(([child]) => parentOf(child) === path);
			return Promise.resolve({
				files: children.filter(([, entry]) => entry.kind === "file").map(([child]) => child),
				folders: children.filter(([, entry]) => entry.kind === "folder").map(([child]) => child),
			});
		},
		read: (path: string): Promise<string> => this.adapter.readBinary(path).then(decode),
		write: (path: string, text: string): Promise<void> => this.adapter.writeBinary(path, encode(text)),
		readBinary: (path: string): Promise<ArrayBuffer> => {
			const entry = this.entries.get(path);
			return entry?.kind === "file" ? Promise.resolve(copy(entry.data)) : Promise.reject(new Error(`ENOENT: ${path}`));
		},
		writeBinary: (path: string, data: ArrayBuffer): Promise<void> => {
			this.store(path, data);
			return Promise.resolve();
		},
		mkdir: (path: string): Promise<void> => {
			this.makeFolders(path);
			return Promise.resolve();
		},
		remove: (path: string): Promise<void> => {
			this.entries.delete(path);
			return Promise.resolve();
		},
		rename: (from: string, to: string): Promise<void> => {
			this.move(from, to);
			return Promise.resolve();
		},
		trashSystem: (path: string): Promise<boolean> => {
			this.removeTree(path);
			return Promise.resolve(true);
		},
		trashLocal: (path: string): Promise<void> => {
			this.removeTree(path);
			return Promise.resolve();
		},
	};

	/** @param name the vault's name, as `getName` gives it */
	constructor(private readonly name = "My vault") {
		super();
	}

	/** The vault's name. */
	getName(): string {
		return this.name;
	}

	/** Puts the file `path`, its text or bytes, in the vault, with its folders, as if it were there when Obsidian started. */
	seed(path: string, content: string | ArrayBuffer): void {
		this.store(path, typeof content === "string" ? encode(content) : content);
	}

	/** Every indexed file and folder, the root first. */
	getAllLoadedFiles(): TAbstractFile[] {
		return [this.root, ...[...this.entries.keys()].filter((path) => !isHidden(path)).map((path) => this.indexOf(path))];
	}

	/** The indexed file or folder at `path`, or null. */
	getAbstractFileByPath(path: string): TFile | TFolder | null {
		return this.entries.has(path) && !isHidden(path) ? this.indexOf(path) : null;
	}

	/** The indexed file at `path`, or null. */
	getFileByPath(path: string): TFile | null {
		const found = this.getAbstractFileByPath(path);
		return found instanceof TFile ? found : null;
	}

	/** The bytes of `file`. */
	readBinary(file: TFile): Promise<ArrayBuffer> {
		return this.adapter.readBinary(file.path);
	}

	/** Creates the file `path`; fails if something is there. */
	createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		if (this.entries.has(path)) return Promise.reject(new Error(`File already exists: ${path}`));
		this.store(path, data);
		const file = this.indexOf(path);
		if (!(file instanceof TFile)) return Promise.reject(new Error(`fake vault: not a file: ${path}`));
		this.trigger("create", file);
		return Promise.resolve(file);
	}

	/** Replaces the bytes of `file`. */
	modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
		this.store(file.path, data);
		this.trigger("modify", this.indexOf(file.path));
		return Promise.resolve();
	}

	/** Replaces the text of `file` with what `change` makes of it; returns the new text. */
	async process(file: TFile, change: (text: string) => string): Promise<string> {
		const before = decode(await this.readBinary(file));
		const after = change(before);
		if (after !== before) await this.modifyBinary(file, encode(after));
		return after;
	}

	/** Creates the folder `path`. */
	createFolder(path: string): Promise<TFolder> {
		if (this.entries.has(path)) return Promise.reject(new Error(`Folder already exists: ${path}`));
		this.makeFolders(path);
		const folder = this.indexOf(path);
		if (!(folder instanceof TFolder)) return Promise.reject(new Error(`fake vault: not a folder: ${path}`));
		this.trigger("create", folder);
		return Promise.resolve(folder);
	}

	/**
	 * Renames `file` to `newPath`, with everything inside a folder. Tells
	 * rename as Obsidian's `vault.rename` does (seen in
	 * test/e2e/desktop/folder-rename-events.test.ts), all before it resolves:
	 * for the file or folder itself, then for each indexed folder and file
	 * inside it, in the order the vault came to know them. That order was
	 * seen for a folder's first rename after its contents were created; after
	 * a rewrite, a second rename or a restart it is this map's order, not a
	 * seen one.
	 */
	rename(file: TAbstractFile, newPath: string): Promise<void> {
		const oldPath = file.path;
		const inside = this.move(oldPath, newPath).filter(({ from }) => from !== oldPath);
		this.trigger("rename", this.indexOf(newPath), oldPath);
		for (const { from, to } of inside) if (!isHidden(to)) this.trigger("rename", this.indexOf(to), from);
		return Promise.resolve();
	}

	/** Removes `file` with everything inside it, as moving it to the trash does. */
	trash(file: TAbstractFile): void {
		const removed = this.indexOf(file.path);
		this.removeTree(file.path);
		this.trigger("delete", removed);
	}

	override on(name: VaultEvent, listener: Listener): FakeEventRef {
		return super.on(name, listener);
	}

	/** Stores `data` at `path`, creating its folders, keeping its creation time when it existed. */
	private store(path: string, data: ArrayBuffer): void {
		this.makeFolders(parentOf(path));
		const existing = this.entries.get(path);
		this.now += 1;
		const ctime = existing?.kind === "file" ? existing.ctime : this.now;
		this.entries.set(path, { kind: "file", data: copy(data), ctime, mtime: this.now });
		const indexed = this.indexed.get(path);
		if (indexed instanceof TFile) indexed.stat = { size: data.byteLength, ctime, mtime: this.now };
	}

	/** Creates `path` and the folders above it where missing. */
	private makeFolders(path: string): void {
		if (path === "") return;
		this.makeFolders(parentOf(path));
		if (!this.entries.has(path)) this.entries.set(path, { kind: "folder" });
	}

	/** Moves the entry at `from`, with everything inside it, to `to`; returns each path moved, in this map's order. */
	private move(from: string, to: string): { from: string; to: string }[] {
		this.makeFolders(parentOf(to));
		const movedPaths: { from: string; to: string }[] = [];
		for (const [path, entry] of [...this.entries]) {
			if (path !== from && !path.startsWith(`${from}/`)) continue;
			const moved = to + path.slice(from.length);
			movedPaths.push({ from: path, to: moved });
			this.entries.delete(path);
			this.entries.set(moved, entry);
			const indexed = this.indexed.get(path);
			this.indexed.delete(path);
			if (indexed !== undefined) {
				indexed.path = moved;
				indexed.name = moved.slice(moved.lastIndexOf("/") + 1);
				this.indexed.set(moved, indexed);
			}
		}
		return movedPaths;
	}

	/** Removes the entry at `path` with everything inside it. */
	private removeTree(path: string): void {
		for (const key of [...this.entries.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.entries.delete(key);
				this.indexed.delete(key);
			}
		}
	}

	/** The one index object of the entry at `path`. */
	private indexOf(path: string): TFile | TFolder {
		const known = this.indexed.get(path);
		if (known !== undefined) return known;
		const entry = this.entries.get(path);
		if (entry === undefined) throw new Error(`fake vault: nothing at ${path}`);
		const made =
			entry.kind === "file"
				? new TFile(path, { size: entry.data.byteLength, ctime: entry.ctime, mtime: entry.mtime })
				: new TFolder(path);
		this.indexed.set(path, made);
		return made;
	}
}

/** The workspace: its events, a layout that a test makes ready, and the notes a test opens in an editor. */
export class FakeWorkspace extends Events {
	/** The workspace's own element, in the main window's document. */
	readonly containerEl: HTMLElement = document.body.createDiv();
	/** Whether the layout is ready. */
	layoutReady = false;
	private readonly waiting: (() => void)[] = [];
	/** The leaves of the notes open in an editor, oldest first. */
	private readonly markdownLeaves: { readonly view: MarkdownView }[] = [];

	/** @param vault the vault whose notes open here */
	constructor(private readonly vault: FakeObsidianVault) {
		super();
	}

	/** Runs `callback` once the layout is ready: at once if it is. */
	onLayoutReady(callback: () => void): void {
		if (this.layoutReady) callback();
		else this.waiting.push(callback);
	}

	/** Makes the layout ready, running the callbacks that waited for it. */
	makeLayoutReady(): void {
		this.layoutReady = true;
		for (const callback of this.waiting.splice(0)) callback();
	}

	/**
	 * Opens `file` in a Markdown view of its own, as the user does. Its
	 * editor holds the file's text and tells each change as `editor-change`;
	 * the file changes only when the view's `save` is called.
	 */
	async openInEditor(file: TFile): Promise<MarkdownView> {
		const text = decode(await this.vault.readBinary(file));
		const editor = new Editor(text, () => this.trigger("editor-change", editor, view));
		const view = new MarkdownView(file, editor, (saved) => this.vault.modifyBinary(file, encode(saved)));
		this.markdownLeaves.push({ view });
		return view;
	}

	/** The leaves showing a view of `type`: for "markdown", those of the notes open in an editor; none of any other type. */
	getLeavesOfType(type: string): { readonly view: MarkdownView }[] {
		return type === "markdown" ? [...this.markdownLeaves] : [];
	}

	/** A leaf to open a file in; the fake opens nothing in it, and it shows no view. */
	getLeaf(_newLeaf?: boolean): { view: null; openFile: () => Promise<void> } {
		return { view: null, openFile: () => Promise.resolve() };
	}
}

/** The fake app: vault, workspace, file manager, secrets and per-vault localStorage. */
export class FakeApp {
	readonly vault: FakeObsidianVault;
	readonly workspace: FakeWorkspace;
	/** Obsidian's secret storage, by id. */
	readonly secrets = new Map<string, string>();
	/** The per-vault localStorage, by key, each value as the JSON it is kept as. */
	readonly localStorage = new Map<string, string>();
	readonly secretStorage = {
		getSecret: (id: string): string | null => this.secrets.get(id) ?? null,
		setSecret: (id: string, secret: string): void => {
			this.secrets.set(id, secret);
		},
	};
	readonly fileManager = {
		trashFile: (file: TAbstractFile): Promise<void> => {
			this.vault.trash(file);
			return Promise.resolve();
		},
	};

	/** @param vaultName the vault's name */
	constructor(vaultName?: string) {
		this.vault = new FakeObsidianVault(vaultName);
		this.workspace = new FakeWorkspace(this.vault);
	}

	/**
	 * Takes over from `before`, the app of the same vault before Obsidian
	 * restarted, what outlives a restart: the vault's files and folders and
	 * its clock, so files written after are timed later, the secrets and the
	 * per-vault localStorage. IndexedDB, fake-indexeddb's one for every app,
	 * needs nothing.
	 */
	persistFrom(before: FakeApp): void {
		for (const [path, stored] of before.vault.entries) {
			this.vault.entries.set(path, stored.kind === "file" ? { ...stored, data: copy(stored.data) } : stored);
		}
		this.vault.now = before.vault.now;
		for (const [id, secret] of before.secrets) this.secrets.set(id, secret);
		for (const [key, value] of before.localStorage) this.localStorage.set(key, value);
	}

	/** The value stored under `key` for this vault, parsed afresh each time, or null. */
	loadLocalStorage(key: string): unknown {
		const stored = this.localStorage.get(key);
		return stored === undefined ? null : (JSON.parse(stored) as unknown);
	}

	/**
	 * Stores `value` under `key` for this vault as JSON, as `localStorage`
	 * keeps only text, so what JSON drops is lost; null removes it.
	 */
	saveLocalStorage(key: string, value: unknown): void {
		if (value === null || value === undefined) this.localStorage.delete(key);
		else this.localStorage.set(key, JSON.stringify(value));
	}
}

/** The UTF-8 text of `data`. */
function decode(data: ArrayBuffer): string {
	return new TextDecoder().decode(data);
}

/** `text` as UTF-8 bytes in a fresh ArrayBuffer. */
function encode(text: string): ArrayBuffer {
	const encoded = new TextEncoder().encode(text);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}
