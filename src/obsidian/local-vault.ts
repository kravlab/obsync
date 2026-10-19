import { MarkdownView, TFile, TFolder, type App, type Editor, type TAbstractFile } from "obsidian";
import type { LocalVault, VaultChangeHint, VaultEntry, VaultPath } from "../engine/local-vault";
import { commonEnds } from "../engine/common-ends";
import { isWithin } from "../engine/paths";
import { decodeUtf8, hasByteOrderMark } from "../engine/utf8";

/**
 * The Local vault port over Obsidian (spec, "Architecture and modules").
 * Visible paths go through the Vault API, so Obsidian's index, editors and
 * links see every change; trashing uses `FileManager.trashFile`, which
 * follows the user's trash setting, and renaming uses `vault.rename`.
 *
 * The configuration folder is not in Obsidian's index, so its entries go
 * through the vault adapter: listed by walking `adapter.list`, trashed with
 * `trashSystem`, falling back to `trashLocal`. Other dot-paths are never
 * listed. Change hints come from the vault's events, which fire for
 * visible paths only.
 *
 * `replace` checks and writes in one step. A note open in an editor is
 * compared with what the editor holds and written through the Editor API,
 * which keeps the cursor and selection (spec, "Sync triggers and
 * lifecycle"): only the range between the common start and end of the old
 * and new text is replaced, then the view is saved. A note with a
 * byte-order mark or CRLF line endings goes to disk as bytes instead,
 * since the editor would drop them. Other text files go through
 * `Vault.process`. The shell reports typing with `noteTyped`; this
 * adapter's own editor writes are not typing.
 */
export class ObsidianLocalVault implements LocalVault {
	readonly configDir: VaultPath;
	/** When each path was last typed into, by `Date.now()`. */
	private readonly typed = new Map<VaultPath, number>();
	/** Whether this adapter is writing into an editor now, so the change is not typing. */
	private writingEditor = false;

	/** @param app the Obsidian app whose vault this is */
	constructor(private readonly app: App) {
		this.configDir = app.vault.configDir;
	}

	async list(): Promise<readonly VaultEntry[]> {
		const visible = this.app.vault
			.getAllLoadedFiles()
			.map(toEntry)
			.filter((entry) => entry !== null);
		return [...visible, ...(await this.listConfiguration(this.configDir))];
	}

	async stat(path: VaultPath): Promise<VaultEntry | null> {
		if (!this.isConfiguration(path)) return toEntry(this.app.vault.getAbstractFileByPath(path));
		const stat = await this.app.vault.adapter.stat(path);
		if (stat === null) return null;
		return stat.type === "file"
			? { kind: "file", path, size: stat.size, mtime: stat.mtime }
			: { kind: "folder", path };
	}

	async read(path: VaultPath): Promise<ArrayBuffer> {
		if (this.isConfiguration(path)) return this.app.vault.adapter.readBinary(path);
		return this.app.vault.readBinary(this.file(path));
	}

	async write(path: VaultPath, data: ArrayBuffer): Promise<void> {
		if (this.isConfiguration(path)) return this.app.vault.adapter.writeBinary(path, data);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return this.app.vault.modifyBinary(existing, data);
		await this.app.vault.createBinary(path, data);
	}

	async replace(path: VaultPath, expected: ArrayBuffer, data: ArrayBuffer): Promise<boolean> {
		const { vault } = this.app;
		if (this.isConfiguration(path)) {
			if (!sameBytes(await vault.adapter.readBinary(path), expected)) return false;
			await vault.adapter.writeBinary(path, data);
			return true;
		}
		const file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;
		const expectedText = decodeUtf8(expected);
		const newText = decodeUtf8(data);
		const view = this.openView(path);
		if (view !== null) {
			// What the editor holds counts, saved or not: unsaved keystrokes must not be replaced.
			if (expectedText === null || view.editor.getValue() !== expectedText.replace(/\r\n/g, "\n")) return false;
			if (newText !== null && isPlainText(expected) && isPlainText(data)) {
				this.writingEditor = true;
				try {
					replaceChangedRange(view.editor, newText);
				} finally {
					this.writingEditor = false;
				}
				// The editor saves on its own only after a pause; the engine records the bytes as on disk now.
				await view.save();
				return true;
			}
			// A byte-order mark or CRLF line endings would not survive the editor: the bytes go to disk as they are.
		}
		if (expectedText !== null && newText !== null && !hasByteOrderMark(expected) && !hasByteOrderMark(data)) {
			let replaced = false;
			await vault.process(file, (current) => {
				if (current !== expectedText) return current;
				replaced = true;
				return newText;
			});
			return replaced;
		}
		if (!sameBytes(await vault.readBinary(file), expected)) return false;
		await vault.modifyBinary(file, data);
		return true;
	}

	lastTypedAt(path: VaultPath): number | null {
		return this.typed.get(path) ?? null;
	}

	/**
	 * Records that the user typed into `path` now; the shell calls it on
	 * each `editor-change`. A change this adapter made itself is ignored.
	 */
	noteTyped(path: VaultPath): void {
		if (!this.writingEditor) this.typed.set(path, Date.now());
	}

	async createFolder(path: VaultPath): Promise<void> {
		if (this.isConfiguration(path)) return this.app.vault.adapter.mkdir(path);
		await this.app.vault.createFolder(path);
	}

	async trash(path: VaultPath): Promise<void> {
		if (!this.isConfiguration(path)) return this.app.fileManager.trashFile(this.entry(path));
		const { adapter } = this.app.vault;
		if (!(await adapter.trashSystem(path))) await adapter.trashLocal(path);
	}

	async rename(from: VaultPath, to: VaultPath): Promise<void> {
		if (this.isConfiguration(from)) return this.app.vault.adapter.rename(from, to);
		return this.app.vault.rename(this.entry(from), to);
	}

	onChange(listener: (hint: VaultChangeHint) => void): () => void {
		const { vault } = this.app;
		const refs = [
			vault.on("create", (file) => listener({ kind: "created", path: file.path })),
			vault.on("modify", (file) => listener({ kind: "modified", path: file.path })),
			vault.on("delete", (file) => listener({ kind: "deleted", path: file.path })),
			vault.on("rename", (file, oldPath) => listener({ kind: "renamed", path: file.path, oldPath })),
		];
		return () => {
			for (const ref of refs) vault.offref(ref);
		};
	}

	/** A Markdown view showing `path`, or null if none does. */
	private openView(path: VaultPath): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const { view } = leaf;
			if (view instanceof MarkdownView && view.file?.path === path) return view;
		}
		return null;
	}

	/** Every entry inside the configuration folder `folder`, walked through the adapter. */
	private async listConfiguration(folder: VaultPath): Promise<VaultEntry[]> {
		const { adapter } = this.app.vault;
		if (!(await adapter.exists(folder))) return [];
		const entries: VaultEntry[] = [];
		const pending = [folder];
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			const entry = await this.stat(next);
			if (entry === null) continue;
			entries.push(entry);
			if (entry.kind === "folder") {
				const { files, folders } = await adapter.list(next);
				pending.push(...folders, ...files);
			}
		}
		return entries;
	}

	/** Whether `path` lies in the configuration folder. */
	private isConfiguration(path: VaultPath): boolean {
		return isWithin(path, this.configDir);
	}

	/** The indexed file or folder at `path`; fails with an Error if there is none. */
	private entry(path: VaultPath): TAbstractFile {
		const found = this.app.vault.getAbstractFileByPath(path);
		if (found === null) throw new Error(`no such entry: ${path}`);
		return found;
	}

	/** The indexed file at `path`; fails with an Error if there is none. */
	private file(path: VaultPath): TFile {
		const found = this.entry(path);
		if (!(found instanceof TFile)) throw new Error(`not a file: ${path}`);
		return found;
	}
}

/** Whether `data` has neither a byte-order mark nor CRLF line endings, which an editor drops. */
function isPlainText(data: ArrayBuffer): boolean {
	return !hasByteOrderMark(data) && !(decodeUtf8(data) ?? "").includes("\r\n");
}

/** Whether `a` and `b` hold the same bytes. */
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/**
 * Makes `editor` hold `text` by replacing only the range between the
 * common start and end of its text and `text`, so a cursor outside that
 * range stays where it is.
 */
function replaceChangedRange(editor: Editor, text: string): void {
	const old = editor.getValue();
	if (old === text) return;
	const { head, tail } = commonEnds([old, text]);
	editor.replaceRange(text.slice(head, text.length - tail), editor.offsetToPos(head), editor.offsetToPos(old.length - tail));
}

/** The port's view of an indexed file or folder; null for none and for the vault root. */
function toEntry(file: TAbstractFile | null): VaultEntry | null {
	if (file instanceof TFile) return { kind: "file", path: file.path, size: file.stat.size, mtime: file.stat.mtime };
	if (file instanceof TFolder && !file.isRoot()) return { kind: "folder", path: file.path };
	return null;
}
