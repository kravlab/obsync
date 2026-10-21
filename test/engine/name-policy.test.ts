import { describe, expect, it } from "vitest";
import { namedProvider, pathCodec } from "../../src/engine/name-policy";
import type { NameRules, Provider } from "../../src/engine/provider";
import { FakeRemote } from "../fakes/fake-remote";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { readText } from "../support/provider-read";

/** Name rules that refuse nothing, with `overrides` on top. */
function rules(overrides: Partial<NameRules> = {}): NameRules {
	return { forbiddenCharacters: [], forbiddenAtEnd: [], reservedNames: [], caseInsensitive: false, ...overrides };
}

describe("pathCodec with skip and report", () => {
	it("keeps a path the provider can store as it is, both ways", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: [":"] }), "skipAndReport");
		expect(codec.toRemote("notes/day one.md")).toBe("notes/day one.md");
		expect(codec.toVault("notes/day one.md")).toBe("notes/day one.md");
	});

	it("refuses a path with a forbidden character in any segment", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: [":"] }), "skipAndReport");
		expect(codec.toRemote("a:b/note.md")).toBeNull();
		expect(codec.toRemote("notes/a:b.md")).toBeNull();
	});

	it("refuses a segment ending with a character forbidden at the end, not one holding it inside", () => {
		const codec = pathCodec(rules({ forbiddenAtEnd: [" "] }), "skipAndReport");
		expect(codec.toRemote("notes /a.md")).toBeNull();
		expect(codec.toRemote("notes/a.md ")).toBeNull();
		expect(codec.toRemote("my notes/a b.md")).toBe("my notes/a b.md");
	});

	it("refuses a reserved name, compared without case on a case-insensitive provider only", () => {
		const insensitive = pathCodec(rules({ reservedNames: ["desktop.ini"], caseInsensitive: true }), "skipAndReport");
		expect(insensitive.toRemote("photos/Desktop.ini")).toBeNull();
		const sensitive = pathCodec(rules({ reservedNames: ["CON"] }), "skipAndReport");
		expect(sensitive.toRemote("CON")).toBeNull();
		expect(sensitive.toRemote("con")).toBe("con");
	});

	it("refuses a segment or a path over its length limit, and takes one exactly at it", () => {
		const codec = pathCodec(rules({ maxSegmentLength: 5, maxPathLength: 9 }), "skipAndReport");
		expect(codec.toRemote("ab/cdefg")).toBe("ab/cdefg");
		expect(codec.toRemote("ab/cdefgh")).toBeNull();
		expect(codec.toRemote("abcd/efgh")).toBe("abcd/efgh");
		expect(codec.toRemote("abcd/efghi")).toBeNull();
	});
});

describe("pathCodec with reversible encoding", () => {
	it("substitutes forbidden punctuation with its fullwidth form and decodes it back", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: [":", "?", "\\"] }), "encodeReversibly");
		expect(codec.toRemote("a:b/why?.md")).toBe("a：b/why？.md");
		expect(codec.toRemote("back\\slash.md")).toBe("back＼slash.md");
		expect(codec.toVault("a：b/why？.md")).toBe("a:b/why?.md");
	});

	it("substitutes control characters and DEL with their control pictures", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: ["\u0000", "\u0009", "\u007F"] }), "encodeReversibly");
		expect(codec.toRemote("a\u0000b\u0009c\u007F.md")).toBe("a␀b␉c␡.md");
		expect(codec.toVault("a␀b␉c␡.md")).toBe("a\u0000b\u0009c\u007F.md");
	});

	it("substitutes a space only at the end of a segment, where it is forbidden", () => {
		const codec = pathCodec(rules({ forbiddenAtEnd: [" "] }), "encodeReversibly");
		expect(codec.toRemote("my notes /a b.md ")).toBe("my notes␠/a b.md␠");
		expect(codec.toVault("my notes␠/a b.md␠")).toBe("my notes /a b.md ");
		expect(codec.toVault("␠lead.md")).toBe("␠lead.md");
	});

	it("leaves every character the provider can store as it is", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: [":"] }), "encodeReversibly");
		expect(codec.toRemote("Заметки/日記 #1 (draft).md")).toBe("Заметки/日記 #1 (draft).md");
		expect(codec.toRemote("wide？question.md")).toBe("wide？question.md");
	});

	it("refuses a name already holding a substitute it would produce, which could not be told apart", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: [":"], forbiddenAtEnd: [" "] }), "encodeReversibly");
		expect(codec.toRemote("wide：colon.md")).toBeNull();
		expect(codec.toRemote("ends␠")).toBeNull();
		expect(codec.toRemote("␠starts.md")).toBe("␠starts.md");
	});

	it("refuses a forbidden character with no substitute in the table", () => {
		const codec = pathCodec(rules({ forbiddenCharacters: ["é"] }), "encodeReversibly");
		expect(codec.toRemote("café.md")).toBeNull();
	});

	it("still refuses reserved names and over-long segments, which no substitution fixes", () => {
		const codec = pathCodec(
			rules({ forbiddenCharacters: [":"], reservedNames: ["thumbs.db"], maxSegmentLength: 6 }),
			"encodeReversibly",
		);
		expect(codec.toRemote("thumbs.db")).toBeNull();
		expect(codec.toRemote("a:bcdefg")).toBeNull();
		expect(codec.toRemote("a:b.md")).toBe("a：b.md");
	});

	it("decodes every path it encodes back to the vault path it came from", () => {
		const codec = pathCodec(
			rules({ forbiddenCharacters: ["\u0000", "\\", "\u007F", ":", "*"], forbiddenAtEnd: [" ", "."] }),
			"encodeReversibly",
		);
		const paths = ["a\\b/c:d*.md", "trailing. /x.md", "nul\u0000/del\u007F", "plain/name.md", " lead/mid dle"];
		for (const path of paths) {
			const remote = codec.toRemote(path);
			expect(remote).not.toBeNull();
			expect(codec.toVault(remote ?? "")).toBe(path);
		}
	});
});

describe("namedProvider", () => {
	/** A Remote refusing ":" with every Capability, reached through vault paths under reversible encoding. */
	function setUp(): { remote: FakeRemote; provider: Provider } {
		const remote = new FakeRemote({ changeFeed: true, fileMove: true, folderMove: true, nameRules: { forbiddenCharacters: [":"] } });
		const stored = remote.openProvider();
		return { remote, provider: namedProvider(stored, pathCodec(stored.nameRules, "encodeReversibly")) };
	}

	it("stores a vault path under its encoded Remote path and gives vault paths back", async () => {
		const { remote, provider } = setUp();
		const folder = await provider.createFolder("10:30");
		const written = await provider.write("10:30/a:b.md", bytes("note"));
		expect(folder.path).toBe("10:30");
		expect(written.path).toBe("10:30/a:b.md");
		expect(remote.get("10\uFF1A30/a\uFF1Ab.md")?.kind).toBe("file");
		expect(await readText(provider, "10:30/a:b.md")).toBe("note");
		expect((await provider.list()).entries.map((entry) => entry.path).sort()).toEqual(["10:30", "10:30/a:b.md"]);
		await provider.delete("10:30/a:b.md");
		expect(remote.get("10\uFF1A30/a\uFF1Ab.md")).toBeUndefined();
	});

	it("gives the change feed's paths as vault paths", async () => {
		const { provider } = setUp();
		const { cursor } = await provider.list();
		await provider.write("x:y.md", bytes("new"));
		const batch = await provider.capabilities.changeFeed?.changes(cursor ?? "");
		expect(batch?.changes.map((change) => change.path)).toEqual(["x:y.md"]);
	});

	it("moves files and folders between encoded paths", async () => {
		const { remote, provider } = setUp();
		await provider.createFolder("a:1");
		await provider.write("a:1/n.md", bytes("n"));
		await provider.write("f:1.md", bytes("f"));
		const moved = await provider.capabilities.fileMove?.moveFile("f:1.md", "f:2.md");
		expect(moved?.path).toBe("f:2.md");
		await provider.capabilities.folderMove?.moveFolder("a:1", "a:2");
		expect(remote.get("f\uFF1A2.md")?.kind).toBe("file");
		expect(remote.get("a\uFF1A2/n.md")?.kind).toBe("file");
		expect(remote.get("a\uFF1A1")).toBeUndefined();
	});

	it("refuses a vault path that cannot be encoded before reaching the provider", async () => {
		const { remote, provider } = setUp();
		await expectFailure(provider.write("wide\uFF1Acolon.md", bytes("x")), "nameNotRepresentable");
		expect(remote.list()).toEqual([]);
	});

	it("keeps the provider's Capabilities, name rules and maximum size", () => {
		const stored = new FakeRemote({ maxFileSize: 9 }).openProvider();
		const provider = namedProvider(stored, pathCodec(stored.nameRules, "skipAndReport"));
		expect(provider.capabilities.conditionalWrite).toBe(true);
		expect(provider.capabilities.changeFeed).toBeUndefined();
		expect(provider.capabilities.fileMove).toBeUndefined();
		expect(provider.capabilities.folderMove).toBeUndefined();
		expect(provider.nameRules).toBe(stored.nameRules);
		expect(provider.maxFileSize).toBe(9);
	});
});
