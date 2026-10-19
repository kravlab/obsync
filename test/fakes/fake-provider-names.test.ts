import { describe, expect, it } from "vitest";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { FakeRemote } from "./fake-remote";
import { readText } from "../support/provider-read";

describe("FakeProvider name rules and size", () => {
	it("reports the configured name rules and maximum file size", () => {
		const provider = new FakeRemote({
			nameRules: { forbiddenCharacters: ["\\"], caseInsensitive: true },
			maxFileSize: 1024,
		}).openProvider();
		expect(provider.nameRules).toEqual({ forbiddenCharacters: ["\\"], reservedNames: [], caseInsensitive: true });
		expect(provider.maxFileSize).toBe(1024);
	});

	it("refuses a name with a forbidden character with nameNotRepresentable", async () => {
		const provider = new FakeRemote({ nameRules: { forbiddenCharacters: [":"] } }).openProvider();
		await expectFailure(provider.write("a:b.md", bytes("a")), "nameNotRepresentable");
		expect((await provider.list()).entries).toEqual([]);
	});

	it("refuses a reserved name with nameNotRepresentable", async () => {
		const provider = new FakeRemote({ nameRules: { reservedNames: ["CON"] } }).openProvider();
		await expectFailure(provider.createFolder("CON"), "nameNotRepresentable");
	});

	it("refuses a segment longer than the limit with nameNotRepresentable", async () => {
		const provider = new FakeRemote({ nameRules: { maxSegmentLength: 5 } }).openProvider();
		await provider.write("a.md", bytes("fits"));
		await expectFailure(provider.write("toolong.md", bytes("a")), "nameNotRepresentable");
	});

	it("refuses a path longer than the limit with nameNotRepresentable", async () => {
		const provider = new FakeRemote({ nameRules: { maxPathLength: 8 } }).openProvider();
		await provider.createFolder("abc");
		await expectFailure(provider.write("abc/de.md", bytes("a")), "nameNotRepresentable");
	});

	it("refuses a file above the maximum size with tooLarge", async () => {
		const provider = new FakeRemote({ maxFileSize: 3 }).openProvider();
		await provider.write("fits.md", bytes("abc"));
		await expectFailure(provider.write("big.md", bytes("abcd")), "tooLarge");
	});

	it("treats names that differ only by case as one entry when case-insensitive", async () => {
		const provider = new FakeRemote({ nameRules: { caseInsensitive: true } }).openProvider();
		await provider.write("note.md", bytes("first"));
		await provider.write("Note.md", bytes("second"));
		expect((await provider.list()).entries.map((entry) => entry.path)).toEqual(["note.md"]);
		expect(await readText(provider, "NOTE.md")).toBe("second");
	});

	it("files a new entry under its folder's case when case-insensitive", async () => {
		const provider = new FakeRemote({ nameRules: { caseInsensitive: true } }).openProvider();
		await provider.createFolder("Notes");
		await provider.write("notes/b.md", bytes("b"));
		expect((await provider.list()).entries.map((entry) => entry.path)).toEqual(["Notes", "Notes/b.md"]);
	});

	it("keeps names that differ only by case apart when case-sensitive", async () => {
		const provider = new FakeRemote().openProvider();
		await provider.write("note.md", bytes("first"));
		await provider.write("Note.md", bytes("second"));
		expect((await provider.list()).entries).toHaveLength(2);
	});
});
