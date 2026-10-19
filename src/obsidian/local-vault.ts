import { TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import type { LocalVault, VaultChangeHint, VaultEntry, VaultPath } from "../engine/local-vault";
import { isWithin } from "../engine/paths";

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
 */
export class ObsidianLocalVault implements LocalVault {
	readonly configDir: VaultPath;

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

/** The port's view of an indexed file or folder; null for none and for the vault root. */
function toEntry(file: TAbstractFile | null): VaultEntry | null {
	if (file instanceof TFile) return { kind: "file", path: file.path, size: file.stat.size, mtime: file.stat.mtime };
	if (file instanceof TFolder && !file.isRoot()) return { kind: "folder", path: file.path };
	return null;
}
