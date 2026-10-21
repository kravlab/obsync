import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../src/engine/local-vault";
import type { RemoteEntry } from "../../src/engine/provider";
import { findRenames, type RenameChecks, type VaultRename } from "../../src/engine/renames";
import { syncListing } from "../../src/engine/sync-listing";
import type { SnapshotEntry } from "../../src/engine/sync-snapshot";

/** A synced file entry with content `hash`, at revision `rev-<hash>`, of size 1. */
function synced(hash: string, extra: Partial<Extract<SnapshotEntry, { kind: "file" }>> = {}): SnapshotEntry {
	return { kind: "file", revision: `rev-${hash}`, hash, size: 1, ...extra };
}

const folder: SnapshotEntry = { kind: "folder" };

/** A vault file at `path`, of size 1. */
function localFile(path: string): VaultEntry {
	return { kind: "file", path, size: 1, mtime: 0 };
}

/** A Remote file at `path`, of size 1, at revision `revision`. */
function remoteFile(path: string, revision: string, stableId?: string): RemoteEntry {
	return stableId === undefined
		? { kind: "file", path, revision, size: 1 }
		: { kind: "file", path, revision, size: 1, stableId };
}

/** One side of a sync, with the content hash of each file named by path. */
interface Side<T> {
	readonly entries: readonly T[];
	readonly hashes?: Readonly<Record<string, string>>;
}

/** What `findRenames` finds for `snapshot` and both sides, with `hints`; records which files it hashed. */
async function renamesOf(
	snapshot: Readonly<Record<string, SnapshotEntry>>,
	local: Side<VaultEntry>,
	remote: Side<RemoteEntry>,
	hints: readonly VaultRename[] = [],
	{ caseInsensitive = false, folderMove = true }: { caseInsensitive?: boolean; folderMove?: boolean } = {},
) {
	const read: string[] = [];
	const checks: RenameChecks = {
		localHash(path) {
			read.push(`local ${path}`);
			const hash = local.hashes?.[path];
			if (hash === undefined) throw new Error(`no local hash for ${path}`);
			return Promise.resolve(hash);
		},
		remoteContent(path) {
			read.push(`remote ${path}`);
			const hash = remote.hashes?.[path];
			const entry = remote.entries.find((candidate) => candidate.path === path);
			if (hash === undefined || entry?.kind !== "file") return Promise.resolve(null);
			return Promise.resolve({ hash, revision: entry.revision });
		},
	};
	const map = new Map(Object.entries(snapshot));
	const listing = syncListing(local.entries, remote.entries, { configDir: ".config", caseInsensitive }, map.keys());
	const renames = await findRenames(map, listing, hints, checks, { caseInsensitive, folderMove });
	return { renames, read };
}

describe("renames found from the rename hints", () => {
	it("finds a file renamed here, to carry to the Remote", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a") },
			{ entries: [localFile("new.md")] },
			{ entries: [remoteFile("old.md", "rev-a")] },
			[{ from: "old.md", to: "new.md" }],
		);
		expect(renames.toRemote).toEqual([{ kind: "file", from: "old.md", to: "new.md" }]);
		expect(renames.toVault).toEqual([]);
		expect([...renames.paths]).toEqual(["old.md"]);
	});

	it("follows a chain of renames to where the file is now", async () => {
		const { renames } = await renamesOf(
			{ "a.md": synced("a") },
			{ entries: [localFile("c.md")] },
			{ entries: [remoteFile("a.md", "rev-a")] },
			[
				{ from: "a.md", to: "b.md" },
				{ from: "b.md", to: "c.md" },
			],
		);
		expect(renames.toRemote).toEqual([{ kind: "file", from: "a.md", to: "c.md" }]);
	});

	it("takes no hint for two files that the hints both take to one path, leaving it to the content", async () => {
		const snapshot = { "p.md": synced("p"), "q.md": synced("q") };
		const remote = { entries: [remoteFile("p.md", "rev-p"), remoteFile("q.md", "rev-q")] };
		const hints = [
			{ from: "p.md", to: "a.md" },
			{ from: "q.md", to: "a.md" },
		];
		const neither = await renamesOf(snapshot, { entries: [localFile("a.md")], hashes: { "a.md": "other" } }, remote, hints);
		const byContent = await renamesOf(snapshot, { entries: [localFile("a.md")], hashes: { "a.md": "q" } }, remote, hints);
		expect(neither.renames.paths.size).toBe(0);
		expect(byContent.renames.toRemote).toEqual([{ kind: "file", from: "q.md", to: "a.md" }]);
	});

	it("ignores a hint whose target the vault no longer has", async () => {
		const { renames } = await renamesOf(
			{ "a.md": synced("a") },
			{ entries: [] },
			{ entries: [remoteFile("a.md", "rev-a")] },
			[{ from: "a.md", to: "b.md" }],
		);
		expect(renames.toRemote).toEqual([]);
		expect(renames.paths.size).toBe(0);
	});

	it("takes a folder's rename to every entry inside it, as one folder rename", async () => {
		const { renames } = await renamesOf(
			{ old: folder, "old/sub": folder, "old/sub/a.md": synced("a") },
			{ entries: [{ kind: "folder", path: "new" }, { kind: "folder", path: "new/sub" }, localFile("new/sub/a.md")] },
			{ entries: [{ kind: "folder", path: "old" }, { kind: "folder", path: "old/sub" }, remoteFile("old/sub/a.md", "rev-a")] },
			[{ from: "old", to: "new" }],
		);
		expect(renames.toRemote).toEqual([
			{ kind: "folder", from: "old", to: "new" },
			{ kind: "folder", from: "old/sub", to: "new/sub" },
			{ kind: "file", from: "old/sub/a.md", to: "new/sub/a.md" },
		]);
	});
});

describe("renames found on the Remote by stable id", () => {
	it("finds a file renamed there, to carry to the vault", async () => {
		const { renames, read } = await renamesOf(
			{ "old.md": synced("a", { stableId: "id-1" }) },
			{ entries: [localFile("old.md")] },
			{ entries: [remoteFile("new.md", "rev-b", "id-1")] },
		);
		expect(renames.toVault).toEqual([{ kind: "file", from: "old.md", to: "new.md" }]);
		expect(read).toEqual([]);
	});

	it("knows a renamed file still holds the synced content when its revision is the synced one", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a", { stableId: "id-1" }) },
			{ entries: [localFile("old.md")] },
			{ entries: [remoteFile("new.md", "rev-a", "id-1")] },
		);
		expect(renames.toVault).toEqual([{ kind: "file", from: "old.md", to: "new.md", revision: "rev-a" }]);
	});

	it("takes a folder found by its id, with its files, as one folder rename", async () => {
		const { renames } = await renamesOf(
			{ old: { kind: "folder", stableId: "id-f" }, "old/a.md": synced("a", { stableId: "id-1" }) },
			{ entries: [{ kind: "folder", path: "old" }, localFile("old/a.md")] },
			{ entries: [{ kind: "folder", path: "new", stableId: "id-f" }, remoteFile("new/a.md", "rev-a", "id-1")] },
		);
		expect(renames.toVault).toEqual([
			{ kind: "folder", from: "old", to: "new" },
			{ kind: "file", from: "old/a.md", to: "new/a.md", revision: "rev-a" },
		]);
	});
});

describe("renames meeting a change on the other side", () => {
	it("records the same rename on both sides only", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a", { stableId: "id-1" }) },
			{ entries: [localFile("new.md")] },
			{ entries: [remoteFile("new.md", "rev-a", "id-1")] },
			[{ from: "old.md", to: "new.md" }],
		);
		expect(renames.sameOnBoth).toEqual([{ kind: "file", from: "old.md", to: "new.md", revision: "rev-a" }]);
		expect([...renames.toRemote, ...renames.toVault]).toEqual([]);
	});

	it("gives the Remote's name to a file renamed differently on both sides", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a", { stableId: "id-1" }) },
			{ entries: [localFile("mine.md")] },
			{ entries: [remoteFile("theirs.md", "rev-b", "id-1")] },
			[{ from: "old.md", to: "mine.md" }],
		);
		expect(renames.differentOnBoth).toEqual([
			{ kind: "file", from: "old.md", vaultPath: "mine.md", remote: { kind: "file", from: "old.md", to: "theirs.md" } },
		]);
	});

	it("keeps a file renamed here and deleted on the Remote", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a") },
			{ entries: [localFile("new.md")] },
			{ entries: [] },
			[{ from: "old.md", to: "new.md" }],
		);
		expect(renames.keptHere).toEqual([{ kind: "file", from: "old.md", to: "new.md" }]);
		expect(renames.toRemote).toEqual([]);
		expect([...renames.paths]).toEqual(["old.md"]);
	});

	it("keeps a file renamed on the Remote and deleted here", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a", { stableId: "id-1" }) },
			{ entries: [] },
			{ entries: [remoteFile("new.md", "rev-a", "id-1")] },
		);
		expect(renames.keptThere).toEqual([{ kind: "file", from: "old.md", to: "new.md", revision: "rev-a" }]);
	});
});

describe("renames found by content hash", () => {
	it("finds a file renamed here while no hint was kept, by its unique content", async () => {
		const { renames } = await renamesOf(
			{ "old.md": synced("a"), "other.md": synced("b") },
			{ entries: [localFile("new.md"), localFile("other.md")], hashes: { "new.md": "a" } },
			{ entries: [remoteFile("old.md", "rev-a"), remoteFile("other.md", "rev-b")] },
		);
		expect(renames.toRemote).toEqual([{ kind: "file", from: "old.md", to: "new.md" }]);
	});

	it("hashes only new files of a vanished file's size", async () => {
		const { renames, read } = await renamesOf(
			{ "old.md": synced("a") },
			{
				entries: [localFile("new.md"), { kind: "file", path: "big.png", size: 99, mtime: 0 }],
				hashes: { "new.md": "a" },
			},
			{ entries: [remoteFile("old.md", "rev-a")] },
		);
		expect(renames.toRemote).toHaveLength(1);
		expect(read).toEqual(["local new.md"]);
	});

	it("hashes nothing when no file vanished", async () => {
		const { read } = await renamesOf(
			{ "old.md": synced("a") },
			{ entries: [localFile("old.md"), localFile("new.md")], hashes: { "new.md": "a" } },
			{ entries: [remoteFile("old.md", "rev-a")] },
		);
		expect(read).toEqual([]);
	});

	it("takes an ambiguous match for a deletion and a new file", async () => {
		const twoVanished = await renamesOf(
			{ "a.md": synced("x"), "b.md": synced("x") },
			{ entries: [localFile("c.md")], hashes: { "c.md": "x" } },
			{ entries: [remoteFile("a.md", "rev-x"), remoteFile("b.md", "rev-x2")] },
		);
		const twoNew = await renamesOf(
			{ "a.md": synced("x") },
			{ entries: [localFile("b.md"), localFile("c.md")], hashes: { "b.md": "x", "c.md": "x" } },
			{ entries: [remoteFile("a.md", "rev-x")] },
		);
		expect(twoVanished.renames.paths.size).toBe(0);
		expect(twoNew.renames.paths.size).toBe(0);
	});

	it("finds a file renamed on the Remote by its unique content, with the revision read", async () => {
		const { renames, read } = await renamesOf(
			{ "old.md": synced("a") },
			{ entries: [localFile("old.md")] },
			{ entries: [remoteFile("new.md", "rev-9")], hashes: { "new.md": "a" } },
		);
		expect(renames.toVault).toEqual([{ kind: "file", from: "old.md", to: "new.md", revision: "rev-9" }]);
		expect(read).toEqual(["remote new.md"]);
	});

	it("takes a folder whose files all moved to one new folder for a folder rename", async () => {
		const { renames } = await renamesOf(
			{ old: folder, "old/a.md": synced("a"), "old/b.md": synced("b") },
			{
				entries: [{ kind: "folder", path: "new" }, localFile("new/a.md"), localFile("new/b.md")],
				hashes: { "new/a.md": "a", "new/b.md": "b" },
			},
			{ entries: [{ kind: "folder", path: "old" }, remoteFile("old/a.md", "rev-a"), remoteFile("old/b.md", "rev-b")] },
		);
		expect(renames.toRemote).toEqual([
			{ kind: "folder", from: "old", to: "new" },
			{ kind: "file", from: "old/a.md", to: "new/a.md" },
			{ kind: "file", from: "old/b.md", to: "new/b.md" },
		]);
	});

	it("leaves a folder whose files went to different places to the deletion rules", async () => {
		const { renames } = await renamesOf(
			{ old: folder, "old/a.md": synced("a"), "old/b.md": synced("b") },
			{
				entries: [{ kind: "folder", path: "new" }, localFile("new/a.md"), localFile("b.md")],
				hashes: { "new/a.md": "a", "b.md": "b" },
			},
			{ entries: [{ kind: "folder", path: "old" }, remoteFile("old/a.md", "rev-a"), remoteFile("old/b.md", "rev-b")] },
		);
		expect(renames.toRemote.map(({ from }) => from)).toEqual(["old/a.md", "old/b.md"]);
		expect(renames.paths.has("old")).toBe(false);
	});

	it("does not move a whole folder when an entry inside it changed name on the other side", async () => {
		const { renames } = await renamesOf(
			{ old: folder, "old/a.md": synced("a", { stableId: "id-a" }), "old/b.md": synced("b") },
			{ entries: [{ kind: "folder", path: "new" }, localFile("new/a.md"), localFile("new/b.md")] },
			{
				entries: [{ kind: "folder", path: "old" }, remoteFile("elsewhere.md", "rev-a", "id-a"), remoteFile("old/b.md", "rev-b")],
			},
			[{ from: "old", to: "new" }],
		);
		expect(renames.toRemote).toEqual([{ kind: "file", from: "old/b.md", to: "new/b.md" }]);
		expect(renames.differentOnBoth.map(({ from }) => from)).toEqual(["old/a.md"]);
		expect(renames.paths.has("old")).toBe(false);
	});

	it("carries only the files of a folder renamed here when the provider cannot move folders", async () => {
		const { renames } = await renamesOf(
			{ old: folder, "old/a.md": synced("a") },
			{ entries: [{ kind: "folder", path: "new" }, localFile("new/a.md")] },
			{ entries: [{ kind: "folder", path: "old" }, remoteFile("old/a.md", "rev-a")] },
			[{ from: "old", to: "new" }],
			{ folderMove: false },
		);
		expect(renames.toRemote).toEqual([{ kind: "file", from: "old/a.md", to: "new/a.md" }]);
		expect(renames.paths.has("old")).toBe(false);
	});
});

describe("case-only renames on a case-insensitive provider", () => {
	it("records a file whose name changed only in case here under its new name", async () => {
		const { renames } = await renamesOf(
			{ "note.md": synced("a") },
			{ entries: [localFile("Note.md")] },
			{ entries: [remoteFile("note.md", "rev-a")] },
			[],
			{ caseInsensitive: true },
		);
		expect(renames.sameOnBoth).toEqual([{ kind: "file", from: "note.md", to: "Note.md" }]);
		expect([...renames.paths]).toEqual(["note.md"]);
	});
});
