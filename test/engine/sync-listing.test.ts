import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../src/engine/local-vault";
import type { RemoteEntry } from "../../src/engine/provider";
import { syncListing } from "../../src/engine/sync-listing";

/** A vault file at `path`. */
function vaultFile(path: string): VaultEntry {
	return { kind: "file", path, size: 1, mtime: 1 };
}

/** A Remote file at `path`. */
function remoteFile(path: string): RemoteEntry {
	return { kind: "file", path, revision: "r1", size: 1 };
}

/** A configuration folder name; the tests here never list it. */
const CONFIG_DIR = ".config";
const caseInsensitive = { configDir: CONFIG_DIR, caseInsensitive: true };
const caseSensitive = { configDir: CONFIG_DIR, caseInsensitive: false };

describe("sync listing: which paths are gone", () => {
	it("tells a path missing from a side's listing as gone there, and a listed one as not", () => {
		const listing = syncListing([vaultFile("here.md")], [remoteFile("there.md")], caseSensitive);
		expect(listing.goneLocally("there.md")).toBe(true);
		expect(listing.goneLocally("here.md")).toBe(false);
		expect(listing.goneRemotely("here.md")).toBe(true);
		expect(listing.goneRemotely("there.md")).toBe(false);
	});

	it("does not take paths left out for a case clash as gone", () => {
		const listing = syncListing([vaultFile("a.md"), vaultFile("A.md")], [remoteFile("a.md")], caseInsensitive);
		expect(listing.local).toEqual([]);
		expect(listing.remote).toEqual([]);
		expect(listing.goneLocally("a.md")).toBe(false);
		expect(listing.goneRemotely("a.md")).toBe(false);
	});

	it("does not take a path left out below a file on the other side as gone", () => {
		const listing = syncListing([vaultFile("x")], [{ kind: "folder", path: "x" }, remoteFile("x/y.md")], caseSensitive);
		expect(listing.remote.map((entry) => entry.path)).not.toContain("x/y.md");
		expect(listing.goneRemotely("x/y.md")).toBe(false);
	});

	it("matches a path in another case as present on a case-insensitive provider only", () => {
		expect(syncListing([], [remoteFile("Notes/A.md")], caseInsensitive).goneRemotely("notes/a.md")).toBe(false);
		expect(syncListing([], [remoteFile("Notes/A.md")], caseSensitive).goneRemotely("notes/a.md")).toBe(true);
		expect(syncListing([vaultFile("Notes/A.md")], [], caseInsensitive).goneLocally("notes/a.md")).toBe(false);
	});
});

describe("sync listing: Remote paths of synced files", () => {
	it("gives a Remote entry the snapshot's path in another case when the vault no longer has it", () => {
		const listing = syncListing([], [remoteFile("Notes/A.md")], caseInsensitive, ["notes/a.md"]);
		expect(listing.remote.map((entry) => entry.path)).toEqual(["notes/a.md"]);
	});

	it("prefers the vault's path over the snapshot's, and keeps the case on a case-sensitive provider", () => {
		expect(
			syncListing([vaultFile("Notes/a.md")], [remoteFile("notes/A.md")], caseInsensitive, ["NOTES/A.md"]).remote.map(
				(entry) => entry.path,
			),
		).toEqual(["Notes/a.md"]);
		expect(syncListing([], [remoteFile("Notes/A.md")], caseSensitive, ["notes/a.md"]).remote.map((entry) => entry.path)).toEqual([
			"Notes/A.md",
		]);
	});
});
