import { describe, expect, it, type TestContext } from "vitest";
import type { FileMove, FolderMove, Provider, RemoteFile } from "../../src/engine/provider";
import { BLOCK_SHA256 } from "../../src/engine/server-hash";
import { bytes, patterned, text } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { readText, readBytes } from "../support/provider-read";

/** A Provider opened with a Per-request limit, and what its HTTP traffic was. */
export interface LimitedRemote {
	readonly provider: Provider;
	/** The largest HTTP request or response body sent or received so far, in bytes. */
	readonly largestBody: () => number;
}

/**
 * The Provider contract suite (spec, "Testing Decisions", seam 2). Every
 * provider must pass it; it reaches the provider only through the Provider
 * interface, so it runs unchanged against a fake or a mocked real service.
 *
 * @param name the provider under test, shown in test names
 * @param openEmptyRemote returns a Provider bound to a new, empty Remote
 * @param openLimitedRemote returns a Provider bound to a new, empty Remote
 *   with the given Per-request limit in bytes, for a provider that talks
 *   HTTP; without it the Per-request limit tests are skipped
 */
export function describeProviderContract(
	name: string,
	openEmptyRemote: () => Promise<Provider>,
	openLimitedRemote?: (limitBytes: number) => Promise<LimitedRemote>,
): void {
	describe(`Provider contract: ${name}`, () => {
		it("reads back the bytes a write stored", async () => {
			const provider = await openEmptyRemote();
			await provider.write("note.md", bytes("hello"));
			expect(await readText(provider, "note.md")).toBe("hello");
		});

		it("lists a written file with the revision and size the write returned", async () => {
			const provider = await openEmptyRemote();
			const written = await provider.write("note.md", bytes("hello"));
			const { entries } = await provider.list();
			expect(written).toMatchObject({ kind: "file", path: "note.md", size: 5 });
			expect(entries).toEqual([
				expect.objectContaining({ kind: "file", path: "note.md", revision: written.revision, size: 5 }),
			]);
		});

		it("reads a file with the revision of the bytes it returned, as the write and the listing report it", async () => {
			const provider = await openEmptyRemote();
			await provider.write("note.md", bytes("one"));
			const written = await provider.write("note.md", bytes("two"));
			const read = await provider.read("note.md");
			expect(text(read.data)).toBe("two");
			expect(read.revision).toBe(written.revision);
			expect((await provider.list()).entries).toEqual([expect.objectContaining({ revision: read.revision })]);
		});

		it("stores an empty file", async () => {
			const provider = await openEmptyRemote();
			const written = await provider.write("empty.md", new ArrayBuffer(0));
			expect(written.size).toBe(0);
			expect((await readBytes(provider, "empty.md")).byteLength).toBe(0);
		});

		it("stores binary bytes unchanged", async () => {
			const provider = await openEmptyRemote();
			const image = new Uint8Array([0x00, 0xff, 0x80, 0xc3, 0x28, 0x0a]);
			await provider.write("image.png", image.buffer);
			expect([...new Uint8Array(await readBytes(provider, "image.png"))]).toEqual([0x00, 0xff, 0x80, 0xc3, 0x28, 0x0a]);
		});

		it("gives an overwritten file a new revision", async () => {
			const provider = await openEmptyRemote();
			const first = await provider.write("note.md", bytes("one"));
			const second = await provider.write("note.md", bytes("two"));
			expect(second.revision).not.toBe(first.revision);
			expect(await readText(provider, "note.md")).toBe("two");
		});

		it("fails reading a missing file with notFound", async () => {
			const provider = await openEmptyRemote();
			await expectFailure(provider.read("missing.md"), "notFound");
		});

		it("lists a created folder and the file written inside it", async () => {
			const provider = await openEmptyRemote();
			const folder = await provider.createFolder("notes");
			const file = await provider.write("notes/a.md", bytes("a"));
			const { entries } = await provider.list();
			expect(folder).toMatchObject({ kind: "folder", path: "notes" });
			expect(entries).toHaveLength(2);
			expect(entries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "folder", path: "notes" }),
					expect.objectContaining({ kind: "file", path: "notes/a.md", revision: file.revision }),
				]),
			);
		});

		it("lists nested entries by their paths below the Remote root", async () => {
			const provider = await openEmptyRemote();
			await provider.createFolder("projects");
			await provider.createFolder("projects/plans");
			await provider.write("projects/plans/q4.md", bytes("plan"));
			const paths = (await provider.list()).entries.map((entry) => `${entry.kind} ${entry.path}`);
			expect(paths.sort()).toEqual(["file projects/plans/q4.md", "folder projects", "folder projects/plans"]);
		});

		it("keeps non-ASCII names exactly, in writing, listing and reading", async () => {
			const provider = await openEmptyRemote();
			await provider.createFolder("Заметки");
			await provider.write("Заметки/café ☕.md", bytes("текст"));
			const paths = (await provider.list()).entries.map((entry) => entry.path);
			expect(paths.sort()).toEqual(["Заметки", "Заметки/café ☕.md"]);
			expect(await readText(provider, "Заметки/café ☕.md")).toBe("текст");
		});

		it("returns an existing folder when it is created again", async () => {
			const provider = await openEmptyRemote();
			await provider.createFolder("notes");
			const again = await provider.createFolder("notes");
			expect(again).toMatchObject({ kind: "folder", path: "notes" });
			expect((await provider.list()).entries).toHaveLength(1);
		});

		it("removes a deleted file from the listing", async () => {
			const provider = await openEmptyRemote();
			await provider.write("note.md", bytes("hello"));
			await provider.delete("note.md");
			expect((await provider.list()).entries).toEqual([]);
			await expectFailure(provider.read("note.md"), "notFound");
		});

		it("removes a deleted empty folder from the listing", async () => {
			const provider = await openEmptyRemote();
			await provider.createFolder("notes");
			await provider.delete("notes");
			expect((await provider.list()).entries).toEqual([]);
		});

		it("fails deleting a missing entry with notFound", async () => {
			const provider = await openEmptyRemote();
			await expectFailure(provider.delete("missing.md"), "notFound");
		});
	});

	describe(`Provider contract: ${name}, change feed`, () => {
		/** Opens a Remote, skipping the test if the provider lacks the Capability. */
		async function openFeed(context: TestContext): Promise<Provider> {
			const provider = await openEmptyRemote();
			if (!provider.capabilities.changeFeed) context.skip();
			return provider;
		}

		it("reports created, overwritten and deleted entries since the listing's cursor", async (context) => {
			const provider = await openFeed(context);
			const feed = provider.capabilities.changeFeed!;
			await provider.write("kept.md", bytes("v1"));
			await provider.write("gone.md", bytes("gone"));
			const { cursor } = await provider.list();
			expect(cursor).toEqual(expect.any(String));

			const updated = await provider.write("kept.md", bytes("v2"));
			const folder = await provider.createFolder("notes");
			const added = await provider.write("notes/added.md", bytes("added"));
			await provider.delete("gone.md");

			const { changes } = await feed.changes(cursor!);
			expect(changes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ kind: "file", path: "kept.md", revision: updated.revision }),
					expect.objectContaining({ kind: "folder", path: folder.path }),
					expect.objectContaining({ kind: "file", path: "notes/added.md", revision: added.revision }),
					{ kind: "deleted", path: "gone.md" },
				]),
			);
			expect(changes).toHaveLength(4);
		});

		it("continues from the cursor the previous batch returned", async (context) => {
			const provider = await openFeed(context);
			const feed = provider.capabilities.changeFeed!;
			const { cursor } = await provider.list();
			await provider.write("one.md", bytes("1"));
			const first = await feed.changes(cursor!);
			const second = await provider.write("two.md", bytes("2"));

			const next = await feed.changes(first.cursor);
			expect(next.changes).toEqual([
				expect.objectContaining({ kind: "file", path: "two.md", revision: second.revision }),
			]);
		});

		it("fails an unknown cursor with cursorLost", async (context) => {
			const provider = await openFeed(context);
			await expectFailure(provider.capabilities.changeFeed!.changes("unknown-cursor"), "cursorLost");
		});
	});

	describe(`Provider contract: ${name}, stable ids`, () => {
		/** Opens a Remote and writes `note.md`, skipping the test if the provider gives no stable ids. */
		async function openWithIds(context: TestContext): Promise<{ provider: Provider; written: RemoteFile }> {
			const provider = await openEmptyRemote();
			const written = await provider.write("note.md", bytes("one"));
			if (written.stableId === undefined) context.skip();
			return { provider, written };
		}

		it("lists a file and a folder with the stable ids they were created with", async (context) => {
			const { provider, written } = await openWithIds(context);
			const folder = await provider.createFolder("notes");
			const listed = new Map((await provider.list()).entries.map((entry) => [entry.path, entry.stableId]));
			expect(listed.get("note.md")).toBe(written.stableId);
			expect(folder.stableId).toEqual(expect.any(String));
			expect(listed.get("notes")).toBe(folder.stableId);
		});

		it("keeps a file's stable id when it is overwritten, and gives another file another one", async (context) => {
			const { provider, written } = await openWithIds(context);
			const overwritten = await provider.write("note.md", bytes("two"));
			const other = await provider.write("other.md", bytes("one"));
			expect(overwritten.stableId).toBe(written.stableId);
			expect(other.stableId).not.toBe(written.stableId);
		});

		it("gives a file deleted and written again a new stable id", async (context) => {
			const { provider, written } = await openWithIds(context);
			await provider.delete("note.md");
			const again = await provider.write("note.md", bytes("one"));
			expect(again.stableId).not.toBe(written.stableId);
		});
	});

	describe(`Provider contract: ${name}, server hashes`, () => {
		it("reports the block SHA-256 of a file's content as its server hash, in listing and write", async (context) => {
			const provider = await openEmptyRemote();
			const written = await provider.write("note.md", bytes("content"));
			if (written.serverHash?.algorithm !== BLOCK_SHA256) return context.skip();
			// The block SHA-256 of "content", computed with openssl.
			const expected = { algorithm: BLOCK_SHA256, value: "c4eec85eb66b79b8f59ff76a97d5d97aac1b5eca8c6675b4e988a5deea786e53" };
			expect(written.serverHash).toEqual(expected);
			const [listed] = (await provider.list()).entries;
			expect(listed?.kind === "file" ? listed.serverHash : undefined).toEqual(expected);
		});
	});

	describe(`Provider contract: ${name}, file move`, () => {
		/** Opens a Remote, skipping the test if the provider lacks the Capability. */
		async function openMove(context: TestContext): Promise<{ provider: Provider; move: FileMove }> {
			const provider = await openEmptyRemote();
			const move = provider.capabilities.fileMove;
			if (move === undefined) context.skip();
			return { provider, move };
		}

		it("moves a file with its content and stable id, into an existing folder", async (context) => {
			const { provider, move } = await openMove(context);
			const written = await provider.write("old.md", bytes("content"));
			await provider.createFolder("archive");
			const moved = await move.moveFile("old.md", "archive/new.md");
			expect(moved).toMatchObject({ kind: "file", path: "archive/new.md", size: 7 });
			expect(moved.stableId).toBe(written.stableId);
			expect(await readText(provider, "archive/new.md")).toBe("content");
			await expectFailure(provider.read("old.md"), "notFound");
			const paths = (await provider.list()).entries.map((entry) => entry.path).sort();
			expect(paths).toEqual(["archive", "archive/new.md"]);
		});

		it("refuses to move a file onto an occupied path with preconditionFailed, replacing nothing", async (context) => {
			const { provider, move } = await openMove(context);
			await provider.write("old.md", bytes("mine"));
			await provider.write("new.md", bytes("theirs"));
			await expectFailure(move.moveFile("old.md", "new.md"), "preconditionFailed");
			expect(await readText(provider, "new.md")).toBe("theirs");
			expect(await readText(provider, "old.md")).toBe("mine");
		});

		it("fails moving a missing file with notFound", async (context) => {
			const { move } = await openMove(context);
			await expectFailure(move.moveFile("missing.md", "new.md"), "notFound");
		});
	});

	describe(`Provider contract: ${name}, folder move`, () => {
		/** Opens a Remote, skipping the test if the provider lacks the Capability. */
		async function openMove(context: TestContext): Promise<{ provider: Provider; move: FolderMove }> {
			const provider = await openEmptyRemote();
			const move = provider.capabilities.folderMove;
			if (move === undefined) context.skip();
			return { provider, move };
		}

		it("moves a folder with everything inside it, keeping each file's revision and stable id", async (context) => {
			const { provider, move } = await openMove(context);
			await provider.createFolder("old");
			await provider.createFolder("old/sub");
			const written = await provider.write("old/sub/a.md", bytes("a"));
			await move.moveFolder("old", "new");
			const entries = (await provider.list()).entries;
			expect(entries.map((entry) => entry.path).sort()).toEqual(["new", "new/sub", "new/sub/a.md"]);
			const moved = entries.find((entry) => entry.path === "new/sub/a.md");
			expect(moved?.stableId).toBe(written.stableId);
			expect(await readText(provider, "new/sub/a.md")).toBe("a");
		});

		it("refuses to move a folder onto an occupied path with preconditionFailed, replacing nothing", async (context) => {
			const { provider, move } = await openMove(context);
			await provider.createFolder("old");
			await provider.createFolder("new");
			await provider.write("new/kept.md", bytes("kept"));
			await expectFailure(move.moveFolder("old", "new"), "preconditionFailed");
			expect((await provider.list()).entries.map((entry) => entry.path).sort()).toEqual(["new", "new/kept.md", "old"]);
		});

		it("fails moving a missing folder with notFound", async (context) => {
			const { move } = await openMove(context);
			await expectFailure(move.moveFolder("missing", "new"), "notFound");
		});
	});

	describe(`Provider contract: ${name}, conditional write`, () => {
		/** Opens a Remote, skipping the test if the provider lacks the Capability. */
		async function openConditional(context: TestContext): Promise<Provider> {
			const provider = await openEmptyRemote();
			if (!provider.capabilities.conditionalWrite) context.skip();
			return provider;
		}

		it("writes a new file on condition that it is absent", async (context) => {
			const provider = await openConditional(context);
			await provider.write("note.md", bytes("new"), { kind: "absent" });
			expect(await readText(provider, "note.md")).toBe("new");
		});

		it("refuses to replace an existing file written on condition that it is absent", async (context) => {
			const provider = await openConditional(context);
			await provider.write("note.md", bytes("theirs"));
			await expectFailure(provider.write("note.md", bytes("mine"), { kind: "absent" }), "preconditionFailed");
			expect(await readText(provider, "note.md")).toBe("theirs");
		});

		it("replaces a file whose revision is the expected one", async (context) => {
			const provider = await openConditional(context);
			const { revision } = await provider.write("note.md", bytes("one"));
			await provider.write("note.md", bytes("two"), { kind: "revision", revision });
			expect(await readText(provider, "note.md")).toBe("two");
		});

		it("refuses to replace a file another write changed since the expected revision", async (context) => {
			const provider = await openConditional(context);
			const { revision } = await provider.write("note.md", bytes("one"));
			await provider.write("note.md", bytes("theirs"));
			await expectFailure(
				provider.write("note.md", bytes("mine"), { kind: "revision", revision }),
				"preconditionFailed",
			);
			expect(await readText(provider, "note.md")).toBe("theirs");
		});

		it("deletes a file whose revision is the expected one", async (context) => {
			const provider = await openConditional(context);
			const { revision } = await provider.write("note.md", bytes("one"));
			await provider.delete("note.md", { kind: "revision", revision });
			expect((await provider.list()).entries).toEqual([]);
		});

		it("refuses to delete a file another write changed since the expected revision", async (context) => {
			const provider = await openConditional(context);
			const { revision } = await provider.write("note.md", bytes("one"));
			await provider.write("note.md", bytes("theirs"));
			await expectFailure(provider.delete("note.md", { kind: "revision", revision }), "preconditionFailed");
			expect(await readText(provider, "note.md")).toBe("theirs");
		});
	});

	describe(`Provider contract: ${name}, Per-request limit`, () => {
		/** The Per-request limit these tests open the Remote with, in bytes. */
		const LIMIT = 1000;

		/** Opens a limited Remote, skipping the test for a provider without HTTP. */
		async function openLimited(context: TestContext): Promise<LimitedRemote> {
			if (!openLimitedRemote) context.skip();
			return openLimitedRemote(LIMIT);
		}

		it("writes a file larger than the limit with no request above it, and lists it with its size", async (context) => {
			const { provider, largestBody } = await openLimited(context);
			const written = await provider.write("scan.pdf", patterned(2 * LIMIT + 500));
			expect(written).toMatchObject({ kind: "file", path: "scan.pdf", size: 2 * LIMIT + 500 });
			expect((await provider.list()).entries).toEqual([
				expect.objectContaining({ path: "scan.pdf", revision: written.revision, size: 2 * LIMIT + 500 }),
			]);
			expect(largestBody()).toBeLessThanOrEqual(LIMIT);
		});

		it("reads back a file larger than the limit with no response above it", async (context) => {
			const { provider, largestBody } = await openLimited(context);
			await provider.write("scan.pdf", patterned(3 * LIMIT));
			await provider.write("photo.jpg", patterned(LIMIT + 1));
			expect([...new Uint8Array(await readBytes(provider, "scan.pdf"))]).toEqual([...new Uint8Array(patterned(3 * LIMIT))]);
			expect([...new Uint8Array(await readBytes(provider, "photo.jpg"))]).toEqual([...new Uint8Array(patterned(LIMIT + 1))]);
			expect(largestBody()).toBeLessThanOrEqual(LIMIT);
		});

		it("keeps a write above the limit conditional on absence and on the revision", async (context) => {
			const { provider } = await openLimited(context);
			if (!provider.capabilities.conditionalWrite) context.skip();
			const theirs = await provider.write("scan.pdf", bytes("theirs"));
			await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT), { kind: "absent" }), "preconditionFailed");
			const stale = { kind: "revision", revision: "0123456789abcdef" } as const;
			await expectFailure(provider.write("scan.pdf", patterned(2 * LIMIT), stale), "preconditionFailed");
			expect(await readText(provider, "scan.pdf")).toBe("theirs");
			await provider.write("scan.pdf", patterned(2 * LIMIT), { kind: "revision", revision: theirs.revision });
			expect((await readBytes(provider, "scan.pdf")).byteLength).toBe(2 * LIMIT);
		});

		it("reads and writes a file of exactly the limit, and an empty one", async (context) => {
			const { provider, largestBody } = await openLimited(context);
			await provider.write("exact.bin", patterned(LIMIT));
			await provider.write("empty.md", new ArrayBuffer(0));
			expect([...new Uint8Array(await readBytes(provider, "exact.bin"))]).toEqual([...new Uint8Array(patterned(LIMIT))]);
			expect((await readBytes(provider, "empty.md")).byteLength).toBe(0);
			expect(largestBody()).toBeLessThanOrEqual(LIMIT);
		});
	});
}
