// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { FakeApp } from "../fakes/obsidian-app";
import { done, downgradeToSchema3 } from "./schema-3-snapshot";

/**
 * An app whose localStorage names the snapshot database `name`, at schema
 * 4 with one record in each store as the current build writes them, and
 * holds a Connection with the current build's flags.
 */
async function currentBuild(name: string): Promise<FakeApp> {
	const opening = indexedDB.open(name, 4);
	opening.onupgradeneeded = () => {
		for (const store of ["entries", "bases", "feed", "marks"]) opening.result.createObjectStore(store);
	};
	const database = await done(opening);
	const transaction = database.transaction(["entries", "bases", "feed", "marks"], "readwrite");
	transaction.objectStore("entries").put({ kind: "file", revision: "r1", hash: "h1", conflicted: true }, "note.md");
	transaction.objectStore("bases").put(new TextEncoder().encode("hello").buffer, "note.md");
	transaction.objectStore("feed").put(
		{
			cursor: "c1",
			entries: [
				{ kind: "file", path: "note.md", revision: "r1", size: 5, serverHash: { algorithm: "dropbox-content-hash", value: "x" } },
				{ kind: "folder", path: "notes" },
			],
		},
		"current",
	);
	transaction.objectStore("marks").put(true, "complete");
	await new Promise<void>((resolve) => (transaction.oncomplete = () => resolve()));
	database.close();
	const app = new FakeApp();
	app.saveLocalStorage("seamsync-snapshot-database", { formatVersion: 1, name });
	app.saveLocalStorage("seamsync-connection", {
		formatVersion: 1,
		connection: { accountId: "a1", remoteRoot: "/My vault", device: { id: "d1", name: "Laptop" }, firstSyncDone: true, reconnectNeeded: true },
	});
	return app;
}

describe("the state the build before First sync left, made from the current build's", () => {
	it("holds the entries, Bases and feed records at schema 3, without marks, conflict marks or server hashes", async () => {
		const app = await currentBuild("schema-3-fixture");

		await downgradeToSchema3(app);

		const database = await done(indexedDB.open("schema-3-fixture"));
		const read = (store: string, key: string) => done(database.transaction(store, "readonly").objectStore(store).get(key));
		expect(database.version).toBe(3);
		expect([...database.objectStoreNames]).toEqual(["bases", "entries", "feed"]);
		expect(await read("entries", "note.md")).toEqual({ kind: "file", revision: "r1", hash: "h1" });
		expect(new TextDecoder().decode((await read("bases", "note.md")) as ArrayBuffer)).toBe("hello");
		expect(await read("feed", "current")).toEqual({
			cursor: "c1",
			entries: [
				{ kind: "file", path: "note.md", revision: "r1", size: 5 },
				{ kind: "folder", path: "notes" },
			],
		});
		database.close();
	});

	it("keeps the Connection without the flags that build did not know", async () => {
		const app = await currentBuild("schema-3-connection");

		await downgradeToSchema3(app);

		expect(app.loadLocalStorage("seamsync-connection")).toEqual({
			formatVersion: 1,
			connection: { accountId: "a1", remoteRoot: "/My vault", device: { id: "d1", name: "Laptop" } },
		});
	});

	it("fails while another connection holds the database open", async () => {
		const app = await currentBuild("schema-3-held");
		const holder = await done(indexedDB.open("schema-3-held"));

		try {
			await expect(downgradeToSchema3(app)).rejects.toThrow(/blocked/);
		} finally {
			holder.close();
		}
	});

	it("fails for a database that is not a snapshot database, or none named", async () => {
		const app = new FakeApp();
		app.saveLocalStorage("seamsync-snapshot-database", { formatVersion: 1, name: "schema-3-missing" });

		await expect(downgradeToSchema3(app)).rejects.toThrow(/not a snapshot database: it has no entries, bases, feed/);
		await expect(downgradeToSchema3(new FakeApp())).rejects.toThrow(/no snapshot database named/);
	});
});
