import type { LocalVault, VaultChangeHint, VaultEntry, VaultPath } from "../../src/engine/local-vault";
import type { Clock } from "../../src/engine/ports";
import { ManualClock } from "./manual-clock";
import { parentOf } from "../../src/engine/paths";

/** An entry as the fake vault stores it. */
type StoredVaultEntry =
	| { readonly kind: "file"; readonly data: ArrayBuffer; readonly mtime: number }
	| { readonly kind: "folder" };

/** How a FakeVault is set up. */
export interface FakeVaultOptions {
	/** Where file modification times come from; a ManualClock at 0 by default. */
	readonly clock?: Clock;
	/**
	 * The vault's configuration folder (`vault.configDir`). The default is
	 * deliberately not Obsidian's usual name: the engine must take the name
	 * from this port, never assume it.
	 */
	readonly configDir?: string;
}

/**
 * An in-memory Local vault for one device. Like the Obsidian adapter it
 * stands in for, it lists visible entries plus the configuration folder,
 * hides every other dot-path, and reports change hints only for visible
 * paths. Missing paths and occupied rename targets fail with a plain Error.
 */
export class FakeVault implements LocalVault {
	private readonly entries = new Map<VaultPath, StoredVaultEntry>();
	private readonly listeners = new Set<(hint: VaultChangeHint) => void>();
	private readonly clock: Clock;
	readonly configDir: string;

	/** @param options the clock and configuration folder */
	constructor(options: FakeVaultOptions = {}) {
		this.clock = options.clock ?? new ManualClock();
		this.configDir = options.configDir ?? ".vault-config";
	}

	list(): Promise<readonly VaultEntry[]> {
		const entries = [...this.entries.keys()]
			.filter((path) => this.isListed(path))
			.map((path) => this.toEntry(path));
		return Promise.resolve(entries.filter((entry) => entry !== null));
	}

	stat(path: VaultPath): Promise<VaultEntry | null> {
		return Promise.resolve(this.toEntry(path));
	}

	read(path: VaultPath): Promise<ArrayBuffer> {
		const stored = this.entries.get(path);
		if (stored?.kind !== "file") return Promise.reject(missing(path));
		return Promise.resolve(stored.data.slice(0));
	}

	write(path: VaultPath, data: ArrayBuffer): Promise<void> {
		if (!this.isFolder(parentOf(path))) return Promise.reject(missing(parentOf(path)));
		const existed = this.entries.has(path);
		this.entries.set(path, { kind: "file", data: data.slice(0), mtime: this.clock.now() });
		this.emit({ kind: existed ? "modified" : "created", path });
		return Promise.resolve();
	}

	createFolder(path: VaultPath): Promise<void> {
		if (!this.isFolder(parentOf(path))) return Promise.reject(missing(parentOf(path)));
		this.entries.set(path, { kind: "folder" });
		this.emit({ kind: "created", path });
		return Promise.resolve();
	}

	trash(path: VaultPath): Promise<void> {
		if (!this.entries.has(path)) return Promise.reject(missing(path));
		for (const inside of this.subtree(path)) this.entries.delete(inside);
		this.emit({ kind: "deleted", path });
		return Promise.resolve();
	}

	rename(from: VaultPath, to: VaultPath): Promise<void> {
		if (!this.entries.has(from)) return Promise.reject(missing(from));
		if (this.entries.has(to)) return Promise.reject(new Error(`already exists: ${to}`));
		if (!this.isFolder(parentOf(to))) return Promise.reject(missing(parentOf(to)));
		for (const inside of this.subtree(from)) {
			const stored = this.entries.get(inside);
			if (!stored) continue;
			this.entries.delete(inside);
			this.entries.set(to + inside.slice(from.length), stored);
		}
		this.emit({ kind: "renamed", path: to, oldPath: from });
		return Promise.resolve();
	}

	onChange(listener: (hint: VaultChangeHint) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Calls every listener, unless `hint` is about a hidden path. */
	private emit(hint: VaultChangeHint): void {
		if (isHidden(hint.path)) return;
		for (const listener of this.listeners) listener(hint);
	}

	/** Whether `path` is visible or inside the configuration folder. */
	private isListed(path: VaultPath): boolean {
		return !isHidden(path) || path === this.configDir || path.startsWith(`${this.configDir}/`);
	}

	/** Whether `path` is the root or an existing folder. */
	private isFolder(path: VaultPath): boolean {
		return path === "" || this.entries.get(path)?.kind === "folder";
	}

	/** `path` and every stored path inside it. */
	private subtree(path: VaultPath): VaultPath[] {
		return [...this.entries.keys()].filter((entry) => entry === path || entry.startsWith(`${path}/`));
	}

	/** The port's view of the entry at `path`, or null. */
	private toEntry(path: VaultPath): VaultEntry | null {
		const stored = this.entries.get(path);
		if (!stored) return null;
		return stored.kind === "file"
			? { kind: "file", path, size: stored.data.byteLength, mtime: stored.mtime }
			: { kind: "folder", path };
	}
}

/** Whether any segment of `path` starts with a dot. */
function isHidden(path: VaultPath): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

/** The error for an operation on a path that does not exist. */
function missing(path: VaultPath): Error {
	return new Error(`no such entry: ${path}`);
}
