// @vitest-environment jsdom
// jsdom on purpose: the fake app builds its workspace in a document, and it is
// where Node's buffers meet the window's, as a realm-dependent check would not survive.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteFeed } from "../../src/engine/ports";
import { DEFAULT_REMOTE_SETTINGS } from "../../src/engine/remote-metadata";
import { ObsidianDeviceStore } from "../../src/obsidian/device-store";
import { FakeApp } from "../fakes/obsidian-app";

/** The stores a test opened, closed after it. */
const opened: ObsidianDeviceStore[] = [];

afterEach(() => {
	for (const store of opened.splice(0)) store.close();
	vi.restoreAllMocks();
});

/** A device store over a fresh fake app's localStorage and IndexedDB. */
function newStore(): ObsidianDeviceStore {
	const store = new ObsidianDeviceStore(new FakeApp() as never);
	opened.push(store);
	return store;
}

describe("the device store over IndexedDB", () => {
	it("keeps the change-feed state's server hashes through a save and a load", async () => {
		const store = newStore();
		const feed: RemoteFeed = {
			cursor: "cursor-1",
			namePolicy: "skipAndReport",
			entries: [
				{ kind: "file", path: "photo.png", revision: "r1", size: 3, serverHash: { algorithm: "dropbox-content-hash", value: "abc" } },
				{ kind: "folder", path: "photos" },
			],
		};

		await store.saveRemoteFeed(feed);

		expect(await store.loadRemoteFeed()).toEqual(feed);
	});

	it("keeps the shared settings last read and a pending change apart, until the Connection is cleared", async () => {
		const store = newStore();
		const known = { ...DEFAULT_REMOTE_SETTINGS, ignoreList: ["Archive/"] };
		const change = { base: known, wanted: { ...known, sizeCeilingBytes: 1_000 } };

		await store.saveSettingsChange(change);
		await store.saveKnownSettings(known);

		expect(await store.loadKnownSettings()).toEqual(known);
		expect(await store.loadSettingsChange()).toEqual(change);
		await store.saveSettingsChange(null);
		expect(await store.loadSettingsChange()).toBeNull();
		expect(await store.loadKnownSettings()).toEqual(known);
		await store.saveSettingsChange(change);
		await store.clear();
		expect(await store.loadKnownSettings()).toBeNull();
		expect(await store.loadSettingsChange()).toBeNull();
	});

	it("reads stored settings that are not valid ones as none", async () => {
		const app = new FakeApp();
		const store = new ObsidianDeviceStore(app as never);
		opened.push(store);
		await store.saveKnownSettings(DEFAULT_REMOTE_SETTINGS);
		await store.saveSettingsChange({ base: DEFAULT_REMOTE_SETTINGS, wanted: DEFAULT_REMOTE_SETTINGS });
		for (const key of ["obsync-known-settings", "obsync-settings-change"]) {
			const stored = app.loadLocalStorage(key) as Record<string, unknown>;
			app.saveLocalStorage(key, { ...stored, formatVersion: 2 });
		}

		expect(await store.loadKnownSettings()).toBeNull();
		expect(await store.loadSettingsChange()).toBeNull();
	});

	it("keeps a text file's Base through a save and a load", async () => {
		const store = newStore();
		const base = new TextEncoder().encode("synced text").buffer;

		await store.saveSnapshotEntry("note.md", { kind: "file", revision: "r1", hash: "h1", size: 11 }, base);

		const loaded = await store.loadBase("note.md");
		expect(loaded === null ? null : new TextDecoder().decode(loaded)).toBe("synced text");
	});

	it("carries a Base along a moved entry", async () => {
		const store = newStore();
		const entry = { kind: "file", revision: "r1", hash: "h1", size: 4 } as const;
		await store.saveSnapshotEntry("old.md", entry, new TextEncoder().encode("text").buffer);

		await store.moveSnapshotEntry("old.md", "new.md", entry);

		const moved = await store.loadBase("new.md");
		expect(moved === null ? null : new TextDecoder().decode(moved)).toBe("text");
		expect(await store.loadBase("old.md")).toBeNull();
	});

	it("reports a failed delete of an old snapshot database in the console", async () => {
		const app = new FakeApp();
		// A database named under another format version, which the next write replaces and deletes.
		app.saveLocalStorage("obsync-snapshot-database", { formatVersion: 0, name: "obsync-snapshot-old" });
		const store = new ObsidianDeviceStore(app as never);
		opened.push(store);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const failure = new Error("cannot delete");
		vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
			const request = { onsuccess: null, onerror: null, onblocked: null, error: failure } as unknown as IDBOpenDBRequest;
			window.setTimeout(() => {
				request.onerror?.(new Event("error"));
			}, 0);
			return request;
		});

		await store.markSnapshotComplete();

		await vi.waitFor(() =>
			expect(consoleError).toHaveBeenCalledWith("obsync: deleting a snapshot database failed", failure),
		);
	});

	it("clears this device's state when another connection blocks deleting its database, reporting it", async () => {
		const app = new FakeApp();
		const store = new ObsidianDeviceStore(app as never);
		opened.push(store);
		await store.markSnapshotComplete();
		const { name } = app.loadLocalStorage("obsync-snapshot-database") as { name: string };
		// Another connection at the current schema version that never closes for a delete.
		const other = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("open failed"));
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await store.clear();

		expect(app.loadLocalStorage("obsync-snapshot-database")).toBeNull();
		expect(consoleError).toHaveBeenCalledWith("obsync: deleting a snapshot database failed", expect.any(Error));
		other.close();
	});

	it("closes a connection that opens after its blocked upgrade was given up", async () => {
		const app = new FakeApp();
		app.saveLocalStorage("obsync-snapshot-database", { formatVersion: 1, name: "obsync-snapshot-blocked" });
		// Another connection on schema version 1 that never closes for an upgrade.
		const other = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("obsync-snapshot-blocked", 1);
			request.onupgradeneeded = () => request.result.createObjectStore("entries");
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("open failed"));
		});
		const close = vi.spyOn(IDBDatabase.prototype, "close");
		const store = new ObsidianDeviceStore(app as never);
		opened.push(store);

		await expect(store.loadSnapshot()).rejects.toThrow(/blocked/);
		other.close();

		// The other connection's close, then the late one's.
		await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));
	});
});
