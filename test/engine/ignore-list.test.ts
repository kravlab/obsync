import { describe, expect, it } from "vitest";
import { ignoreList } from "../../src/engine/ignore-list";

describe("ignoreList", () => {
	it("ignores nothing with no patterns", () => {
		const list = ignoreList([], false);
		expect(list.ignores("notes/a.md", "file")).toBe(false);
		expect(list.ignores("notes", "folder")).toBe(false);
	});

	it("ignores a folder named by a folder pattern at any depth, with everything inside it", () => {
		const list = ignoreList(["Archive/"], false);
		expect(list.ignores("Archive", "folder")).toBe(true);
		expect(list.ignores("Archive/2020/old.md", "file")).toBe(true);
		expect(list.ignores("projects/Archive/plan.md", "file")).toBe(true);
	});

	it("does not take a file for a folder a folder pattern names", () => {
		expect(ignoreList(["Archive/"], false).ignores("Archive", "file")).toBe(false);
	});

	it("ignores files by an extension pattern", () => {
		const list = ignoreList(["*.tmp"], false);
		expect(list.ignores("scratch/a.tmp", "file")).toBe(true);
		expect(list.ignores("scratch/a.md", "file")).toBe(false);
	});

	it("anchors a pattern starting with a slash to the vault root", () => {
		const list = ignoreList(["/Templates"], false);
		expect(list.ignores("Templates/daily.md", "file")).toBe(true);
		expect(list.ignores("work/Templates/daily.md", "file")).toBe(false);
	});

	it("takes a file back with a negated pattern", () => {
		const list = ignoreList(["*.tmp", "!keep.tmp"], false);
		expect(list.ignores("keep.tmp", "file")).toBe(false);
		expect(list.ignores("drop.tmp", "file")).toBe(true);
	});

	it("matches without case on a case-insensitive provider only", () => {
		expect(ignoreList(["Archive/"], true).ignores("ARCHIVE/a.md", "file")).toBe(true);
		expect(ignoreList(["Archive/"], false).ignores("ARCHIVE/a.md", "file")).toBe(false);
	});

	it("skips comment lines and blank patterns", () => {
		const list = ignoreList(["# drafts", "", "   "], false);
		expect(list.ignores("# drafts", "file")).toBe(false);
		expect(list.ignores("notes/a.md", "file")).toBe(false);
	});
});
