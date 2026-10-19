import {
	ProviderError,
	type Capabilities,
	type ChangeBatch,
	type Listing,
	type NameRules,
	type Precondition,
	type Provider,
	type ProviderFailure,
	type RemoteFile,
	type RemoteFolder,
	type RemotePath,
	type RemoteContent,
} from "../../src/engine/provider";
import { toRemoteFile, type FakeRemote, type StoredFile } from "./fake-remote";
import { parentOf } from "../../src/engine/paths";

/** The operations a FakeProvider counts and can inject faults into. */
export type FakeOperation =
	| "list"
	| "read"
	| "write"
	| "delete"
	| "createFolder"
	| "changes"
	| "moveFile"
	| "moveFolder";

/**
 * Thrown in place of a result when a test makes the device "crash": the
 * app was killed between two steps. It is not a ProviderError, so no
 * engine code may treat it as a provider failure; the test drops the
 * engine and starts a new one over the same stores.
 */
export class SimulatedCrash extends Error {
	override readonly name = "SimulatedCrash";
}

/**
 * One device's Provider on a FakeRemote. It stores whole buffers in memory,
 * copying them in and out so callers never share bytes with the Remote.
 *
 * It is stricter than the contract where that exposes engine bugs: a write
 * into a missing folder fails with `notFound` instead of creating it, a
 * file never replaces a folder nor a folder a file (`preconditionFailed`),
 * and two engine mistakes throw a plain Error: deleting a folder that is
 * not empty, and passing a precondition without the conditional-write
 * Capability.
 *
 * Tests steer one device through `failNext`, `beforeNext`, `crashBefore`
 * and `crashAfter`; other devices on the same Remote are unaffected.
 */
export class FakeProvider implements Provider {
	readonly capabilities: Capabilities;
	readonly nameRules: NameRules;
	readonly maxFileSize: number;

	/** Failures to raise, in order, on the next calls of each operation. */
	private readonly failures = new Map<FakeOperation, ProviderFailure[]>();
	/** Hooks to run, in order, before the next calls of each operation. */
	private readonly hooks = new Map<FakeOperation, (() => Promise<void>)[]>();
	/** Hooks to run once, before the next read of each path. */
	private readonly readHooks = new Map<RemotePath, () => Promise<void>>();
	/** Operations started so far on this device. */
	private operationCount = 0;
	private crash: { readonly at: number; readonly when: "before" | "after" } | undefined;

	/** @param remote the Remote this device syncs */
	constructor(private readonly remote: FakeRemote) {
		const { service } = remote;
		this.nameRules = remote.nameRules;
		this.maxFileSize = remote.maxFileSize;
		this.capabilities = {
			conditionalWrite: service.conditionalWrite ?? true,
			changeFeed: service.changeFeed
				? { changes: (cursor) => this.run("changes", () => this.changes(cursor)) }
				: undefined,
			fileMove: service.fileMove
				? { moveFile: (from, to) => this.run("moveFile", () => this.moveFile(from, to)) }
				: undefined,
			folderMove: service.folderMove
				? { moveFolder: (from, to) => this.run("moveFolder", () => this.moveFolder(from, to)) }
				: undefined,
		};
	}

	/** Makes the next call of `operation` fail with `failure`, doing nothing. */
	failNext(operation: FakeOperation, failure: ProviderFailure): void {
		queue(this.failures, operation).push(failure);
	}

	/**
	 * Runs `hook` just before the next call of `operation` takes effect,
	 * e.g. another device's write racing this one.
	 */
	beforeNext(operation: FakeOperation, hook: () => Promise<void>): void {
		queue(this.hooks, operation).push(hook);
	}

	/**
	 * Runs `hook` just before the next read of `path` takes effect, e.g. the
	 * user editing the vault file while its Remote version downloads.
	 */
	beforeNextRead(path: RemotePath, hook: () => Promise<void>): void {
		this.readHooks.set(path, hook);
	}

	/** Makes the `n`th operation from now throw SimulatedCrash, undone. */
	crashBefore(n: number): void {
		this.crash = { at: this.operationCount + n, when: "before" };
	}

	/** Makes the `n`th operation from now take effect, then throw SimulatedCrash. */
	crashAfter(n: number): void {
		this.crash = { at: this.operationCount + n, when: "after" };
	}

	list(): Promise<Listing> {
		return this.run("list", () => {
			const cursor = this.capabilities.changeFeed ? this.remote.cursor() : undefined;
			return Promise.resolve({ entries: this.remote.list(), cursor });
		});
	}

	read(path: RemotePath): Promise<RemoteContent> {
		return this.run("read", async () => {
			const hook = this.readHooks.get(path);
			this.readHooks.delete(path);
			if (hook) await hook();
			const stored = this.remote.get(path);
			if (stored?.kind !== "file") throw notFound(path);
			return { data: stored.data.slice(0), revision: stored.revision };
		});
	}

	write(path: RemotePath, data: ArrayBuffer, precondition?: Precondition): Promise<RemoteFile> {
		return this.run("write", () => {
			this.checkName(path);
			if (data.byteLength > this.maxFileSize) {
				throw new ProviderError({ category: "tooLarge" }, `too large: ${path}`);
			}
			if (!this.remote.isFolder(parentOf(path))) throw notFound(parentOf(path));
			if (this.remote.isFolder(path)) throw preconditionFailed(path);
			if (!this.holds(path, precondition)) throw preconditionFailed(path);
			const stored: StoredFile = { kind: "file", data: data.slice(0), revision: this.remote.nextRevision() };
			this.remote.put(path, stored);
			return Promise.resolve(toRemoteFile(path, stored));
		});
	}

	delete(path: RemotePath, precondition?: Precondition): Promise<void> {
		return this.run("delete", () => {
			const stored = this.remote.get(path);
			if (!stored) throw notFound(path);
			if (!this.holds(path, precondition)) throw preconditionFailed(path);
			if (stored.kind === "folder" && this.remote.hasChildren(path)) {
				throw new Error(`engine bug: recursive delete of ${path}`);
			}
			this.remote.remove(path);
			return Promise.resolve();
		});
	}

	createFolder(path: RemotePath): Promise<RemoteFolder> {
		return this.run("createFolder", () => {
			this.checkName(path);
			if (!this.remote.isFolder(parentOf(path))) throw notFound(parentOf(path));
			if (this.remote.get(path)?.kind === "file") throw preconditionFailed(path);
			if (!this.remote.get(path)) this.remote.put(path, { kind: "folder" });
			return Promise.resolve({ kind: "folder", path });
		});
	}

	/** The change feed Capability, when the service offers it. */
	private changes(cursor: string): Promise<ChangeBatch> {
		const batch = this.remote.changesSince(cursor);
		if (!batch) throw new ProviderError({ category: "cursorLost" }, `unknown cursor: ${cursor}`);
		return Promise.resolve(batch);
	}

	/** The file move Capability, when the service offers it. */
	private moveFile(from: RemotePath, to: RemotePath): Promise<RemoteFile> {
		const stored = this.remote.get(from);
		if (stored?.kind !== "file") throw notFound(from);
		this.checkName(to);
		if (!this.remote.isFolder(parentOf(to))) throw notFound(parentOf(to));
		if (this.remote.get(to)) throw preconditionFailed(to);
		this.remote.move(from, to);
		return Promise.resolve(toRemoteFile(to, stored));
	}

	/** The folder move Capability, when the service offers it. */
	private moveFolder(from: RemotePath, to: RemotePath): Promise<void> {
		if (from === "" || !this.remote.isFolder(from)) throw notFound(from);
		if (!this.remote.isFolder(parentOf(to))) throw notFound(parentOf(to));
		if (this.remote.get(to)) throw preconditionFailed(to);
		for (const path of this.remote.subtree(from)) this.checkName(to + path.slice(from.length));
		this.remote.move(from, to);
		return Promise.resolve();
	}

	/**
	 * Runs one operation with this device's injected behaviour: a crash
	 * before it, then racing hooks, then a queued failure, then the
	 * operation itself (`effect`, which throws its own errors
	 * synchronously), then a crash after it.
	 */
	private async run<T>(operation: FakeOperation, effect: () => Promise<T>): Promise<T> {
		this.operationCount += 1;
		const crashesHere = this.crash?.at === this.operationCount ? this.crash.when : undefined;
		if (crashesHere === "before") throw new SimulatedCrash(`crash before ${operation}`);
		const hook = this.hooks.get(operation)?.shift();
		if (hook) await hook();
		const failure = this.failures.get(operation)?.shift();
		if (failure) throw new ProviderError(failure, `injected ${failure.category} on ${operation}`);
		const result = await effect();
		if (crashesHere === "after") throw new SimulatedCrash(`crash after ${operation}`);
		return result;
	}

	/** Throws `nameNotRepresentable` if the service cannot store `path`. */
	private checkName(path: RemotePath): void {
		if (!this.remote.canStore(path)) {
			throw new ProviderError({ category: "nameNotRepresentable" }, `name not representable: ${path}`);
		}
	}

	/**
	 * Whether the Remote's current state at `path` meets `precondition`.
	 * Throws if the engine passes one without the Capability.
	 */
	private holds(path: RemotePath, precondition: Precondition | undefined): boolean {
		if (precondition && !this.capabilities.conditionalWrite) {
			throw new Error(`engine bug: precondition on ${path} without conditional write`);
		}
		const stored = this.remote.get(path);
		switch (precondition?.kind) {
			case undefined:
				return true;
			case "absent":
				return stored === undefined;
			case "revision":
				return stored?.kind === "file" && stored.revision === precondition.revision;
		}
	}
}

/** The queue for `operation` in `queues`, created empty if missing. */
function queue<T>(queues: Map<FakeOperation, T[]>, operation: FakeOperation): T[] {
	let items = queues.get(operation);
	if (!items) {
		items = [];
		queues.set(operation, items);
	}
	return items;
}

/** The error for an operation on a path that does not exist. */
function notFound(path: RemotePath): ProviderError {
	return new ProviderError({ category: "notFound" }, `not found: ${path}`);
}

/** The error for an operation whose expected state at `path` did not hold. */
function preconditionFailed(path: RemotePath): ProviderError {
	return new ProviderError({ category: "preconditionFailed" }, `precondition failed: ${path}`);
}
