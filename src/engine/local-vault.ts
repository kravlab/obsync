/**
 * The Local vault port: the engine's view of this device's vault (spec,
 * "Architecture and modules"). The Obsidian adapter behind it trashes
 * through `FileManager.trashFile` and renames through `vault.rename`. Hidden
 * configuration paths are not in Obsidian's vault index, so for them it goes
 * through the vault adapter: `adapter.trashSystem` / `trashLocal` and
 * `adapter.rename`.
 */
import { foldersDownTo } from "./paths";

/** A path relative to the vault root, as Obsidian names it. */
export type VaultPath = string;

/** A file in the vault. */
export interface VaultFile {
	readonly kind: "file";
	readonly path: VaultPath;
	/** Size in bytes. */
	readonly size: number;
	/** Modification time in ms since the epoch. */
	readonly mtime: number;
}

/** A folder in the vault. */
interface VaultFolder {
	readonly kind: "folder";
	readonly path: VaultPath;
}

/** One entry of the vault. */
export type VaultEntry = VaultFile | VaultFolder;

/**
 * Something the vault reported changing. Hints only: they are missed while
 * Obsidian is closed and never fire for hidden paths, so the engine still
 * finds changes by walking the vault.
 */
export type VaultChangeHint =
	| { readonly kind: "created" | "modified" | "deleted"; readonly path: VaultPath }
	| { readonly kind: "renamed"; readonly path: VaultPath; readonly oldPath: VaultPath };

/** This device's vault. Paths of missing entries fail with an Error. */
export interface LocalVault {
	/**
	 * The vault's configuration folder (`vault.configDir`). Its name differs
	 * between devices, so the engine takes it from here, never assumes it.
	 */
	readonly configDir: VaultPath;
	/**
	 * Lists every visible entry plus the configuration folder's entries;
	 * other dot-paths (such as `.git` or `.trash`) are not listed.
	 */
	list(): Promise<readonly VaultEntry[]>;
	/** Returns the entry at `path`, or null if there is none. */
	stat(path: VaultPath): Promise<VaultEntry | null>;
	/** Reads a whole file. */
	read(path: VaultPath): Promise<ArrayBuffer>;
	/** Creates or replaces a whole file; its parent folder must exist. */
	write(path: VaultPath, data: ArrayBuffer): Promise<void>;
	/**
	 * Replaces the file at `path` with `data` only if it still holds
	 * exactly `expected`, checked and written in one step, so an edit made
	 * meanwhile is never overwritten; returns whether it replaced it. For a
	 * note open in an editor, what the editor holds counts, saved or not,
	 * and the new content is on disk once this resolves.
	 */
	replace(path: VaultPath, expected: ArrayBuffer, data: ArrayBuffer): Promise<boolean>;
	/** Creates a folder; its parent folder must exist. */
	createFolder(path: VaultPath): Promise<void>;
	/** Moves a file or folder to the trash the user's setting chooses. */
	trash(path: VaultPath): Promise<void>;
	/** Renames or moves a file or folder; `to` must be free. */
	rename(from: VaultPath, to: VaultPath): Promise<void>;
	/**
	 * When the user last typed into `path` in an editor, in ms since the
	 * epoch as the engine's Clock counts, or null if not since the plugin
	 * started. A note typed into within the post-edit pause is not written.
	 */
	lastTypedAt(path: VaultPath): number | null;
	/**
	 * Calls `listener` for each change hint until the returned function is
	 * called.
	 */
	onChange(listener: (hint: VaultChangeHint) => void): () => void;
}

/** Creates the folder `path` in `vault`, and the folders above it, where missing. */
export async function ensureVaultFolder(vault: LocalVault, path: VaultPath): Promise<void> {
	for (const folder of foldersDownTo(path)) {
		if ((await vault.stat(folder)) === null) await vault.createFolder(folder);
	}
}

/** The LocalVault methods that change the vault. */
export type VaultWrites = Pick<LocalVault, "write" | "replace" | "createFolder" | "trash" | "rename">;

/**
 * `vault` with the methods in `writes` in place of its own, for watching
 * or marking what is written; every other member is the vault's, its
 * methods running on the vault itself, which may keep state on `this`.
 */
export function withVaultWrites(vault: LocalVault, writes: Partial<VaultWrites>): LocalVault {
	return new Proxy(vault, {
		get(target, property, receiver) {
			if (Object.prototype.hasOwnProperty.call(writes, property)) return writes[property as keyof VaultWrites];
			const value: unknown = Reflect.get(target, property, receiver);
			return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
		},
	});
}
