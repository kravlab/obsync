import type { LocalVault, VaultChangeHint, VaultEntry, VaultPath } from "../../src/engine/local-vault";
import type { Clock } from "../../src/engine/ports";
import { ManualClock } from "./manual-clock";
import { parentOf } from "../../src/engine/paths";

/** An entry as the fake vault stores it. */
type StoredVaultEntry = { readonly kind: "file"; readonly data: ArrayBuffer; readonly mtime: number } | { readonly kind: "folder" };

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
	/** Every path moved to the trash, oldest first; trashed entries are gone from the vault. */
	readonly trashed: VaultPath[] = [];
	private readonly listeners = new Set<(hint: VaultChangeHint) => void>();
	/** When each path was last typed into, by the clock. */
	private readonly typed = new Map<VaultPath, number>();
	/** Hooks to run once, just before the engine's next write to each path takes effect. */
	private readonly beforeWrite = new Map<VaultPath, () => Promise<void>>();
	/** Hooks to run once, just after the engine's next write to each path took effect. */
	private readonly afterWrite = new Map<VaultPath, () => Promise<void>>();
	private readonly clock: Clock;
	readonly configDir: string;

	/** @param options the clock and configuration folder */
	constructor(options: FakeVaultOptions = {}) {
		this.clock = options.clock ?? new ManualClock();
		this.configDir = options.configDir ?? ".vault-config";
	}

	list(): Promise<readonly VaultEntry[]> {
		const entries = [...this.entries.keys()].filter((path) => this.isListed(path)).map((path) => this.toEntry(path));
		return Promise.resolve(entries.filter((entry) => entry !== null));
	}

	stat(path: VaultPath): Promise<VaultEntry | null> {
		return Promise.resolve(this.toEntry(path));
	}

	/**
	 * Writes `data` to `path` as the user typing it in an editor would,
	 * so `lastTypedAt` reports the clock's time now.
	 */
	async typeInto(path: VaultPath, data: ArrayBuffer): Promise<void> {
		await this.store(path, data);
		this.typed.set(path, this.clock.now());
	}

	lastTypedAt(path: VaultPath): number | null {
		return this.typed.get(path) ?? null;
	}

	/**
	 * Runs `hook` once, just before the engine's next write to `path`
	 * takes effect: the user editing the file at the last moment.
	 */
	beforeNextWrite(path: VaultPath, hook: () => Promise<void>): void {
		this.beforeWrite.set(path, hook);
	}

	/**
	 * Runs `hook` once, just after the engine's next write to `path` took
	 * effect: the user saving again before the sync records the file.
	 */
	afterNextWrite(path: VaultPath, hook: () => Promise<void>): void {
		this.afterWrite.set(path, hook);
	}

	read(path: VaultPath): Promise<ArrayBuffer> {
		const stored = this.entries.get(path);
		if (stored?.kind !== "file") return Promise.reject(missing(path));
		return Promise.resolve(stored.data.slice(0));
	}

	async write(path: VaultPath, data: ArrayBuffer): Promise<void> {
		await this.runBeforeWrite(path);
		await this.store(path, data);
		await this.runAfterWrite(path);
	}

	async replace(path: VaultPath, expected: ArrayBuffer, data: ArrayBuffer): Promise<boolean> {
		await this.runBeforeWrite(path);
		const stored = this.entries.get(path);
		if (stored?.kind !== "file" || !sameBytes(stored.data, expected)) return false;
		await this.store(path, data);
		await this.runAfterWrite(path);
		return true;
	}

	/**
	 * Rewrites the file at `path` with `data` but keeps its modification
	 * time, as a file system with coarse timestamps or a tool that restores
	 * mtimes would: a change that size and mtime alone cannot see.
	 */
	writeKeepingMtime(path: VaultPath, data: ArrayBuffer): Promise<void> {
		const previous = this.entries.get(path);
		if (previous?.kind !== "file") return Promise.reject(missing(path));
		this.entries.set(path, { kind: "file", data: data.slice(0), mtime: previous.mtime });
		this.emit({ kind: "modified", path });
		return Promise.resolve();
	}

	/** Runs and forgets the hook waiting for the end of a write to `path`, if any. */
	private async runAfterWrite(path: VaultPath): Promise<void> {
		const hook = this.afterWrite.get(path);
		this.afterWrite.delete(path);
		if (hook) await hook();
	}

	/** Runs and forgets the hook waiting for a write to `path`, if any. */
	private async runBeforeWrite(path: VaultPath): Promise<void> {
		const hook = this.beforeWrite.get(path);
		this.beforeWrite.delete(path);
		if (hook) await hook();
	}

	/**
	 * Stores `data` at `path` and reports the change. A rewrite advances
	 * `mtime` by at least 1 ms when the clock has not moved.
	 */
	private store(path: VaultPath, data: ArrayBuffer): Promise<void> {
		if (!this.isFolder(parentOf(path))) return Promise.reject(missing(parentOf(path)));
		const previous = this.entries.get(path);
		const now = this.clock.now();
		const mtime = previous?.kind === "file" && now <= previous.mtime ? previous.mtime + 1 : now;
		this.entries.set(path, { kind: "file", data: data.slice(0), mtime });
		this.emit({ kind: previous ? "modified" : "created", path });
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
		this.trashed.push(path);
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

/** Whether `a` and `b` hold the same bytes. */
function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
