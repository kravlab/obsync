import { describe, expect, it } from "vitest";
import { ancestorsOf, foldersDownTo, isWithin, nameOf, parentOf, splitName } from "../../src/engine/paths";

describe("parentOf", () => {
	it("gives the folder holding a nested path", () => {
		expect(parentOf("notes/daily/today.md")).toBe("notes/daily");
	});

	it("gives the top for a path with no folder", () => {
		expect(parentOf("note.md")).toBe("");
	});
});

describe("ancestorsOf", () => {
	it("lists the folders holding a nested path, outermost first", () => {
		expect(ancestorsOf("notes/daily/today.md")).toEqual(["notes", "notes/daily"]);
	});

	it("is empty for a path at the top", () => {
		expect(ancestorsOf("note.md")).toEqual([]);
	});
});

describe("foldersDownTo", () => {
	it("lists the folders from the top down to the path itself", () => {
		expect(foldersDownTo("notes/daily")).toEqual(["notes", "notes/daily"]);
	});

	it("is empty for the root", () => {
		expect(foldersDownTo("")).toEqual([]);
	});
});

describe("nameOf", () => {
	it("gives the last segment of a nested path", () => {
		expect(nameOf("notes/daily/today.md")).toBe("today.md");
	});

	it("gives a path at the top as it is", () => {
		expect(nameOf("note.md")).toBe("note.md");
	});
});

describe("isWithin", () => {
	it("holds for the folder itself and for paths inside it", () => {
		expect(isWithin(".seamsync", ".seamsync")).toBe(true);
		expect(isWithin(".seamsync/devices/a.json", ".seamsync")).toBe(true);
	});

	it("does not hold for a sibling that only shares the prefix", () => {
		expect(isWithin(".seamsync-notes/a.md", ".seamsync")).toBe(false);
	});
});

describe("splitName", () => {
	it("splits a name at its last dot, the dot going with the extension", () => {
		expect(splitName("archive.tar.gz")).toEqual({ stem: "archive.tar", extension: ".gz" });
	});

	it("gives a name without a dot no extension", () => {
		expect(splitName("LICENSE")).toEqual({ stem: "LICENSE", extension: "" });
	});

	it("takes a name whose only dot starts it as having no extension", () => {
		expect(splitName(".hidden")).toEqual({ stem: ".hidden", extension: "" });
	});

	it("keeps a trailing dot as an empty extension", () => {
		expect(splitName("draft.")).toEqual({ stem: "draft", extension: "." });
	});
});
