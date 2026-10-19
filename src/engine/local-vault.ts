/**
 * The Local vault port: the engine's view of this device's vault (spec,
 * "Architecture and modules"). The Obsidian adapter behind it trashes
 * through `FileManager.trashFile` and renames through `vault.rename`. Hidden
 * configuration paths are not in Obsidian's vault index, so for them it goes
 * through the vault adapter: `adapter.trashSystem` / `trashLocal` and
 * `adapter.rename`.
 */

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
export interface VaultFolder {
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
	/** Creates a folder; its parent folder must exist. */
	createFolder(path: VaultPath): Promise<void>;
	/** Moves a file or folder to the trash the user's setting chooses. */
	trash(path: VaultPath): Promise<void>;
	/** Renames or moves a file or folder; `to` must be free. */
	rename(from: VaultPath, to: VaultPath): Promise<void>;
	/**
	 * Calls `listener` for each change hint until the returned function is
	 * called.
	 */
	onChange(listener: (hint: VaultChangeHint) => void): () => void;
}
