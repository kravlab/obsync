import { describe, expect, it } from "vitest";
import { selectStrings } from "../../src/ui/i18n/strings";
import { skippedCount, skippedLines } from "../../src/ui/skipped-text";

const files = [
	{ path: "Note.md", reason: "caseClash" },
	{ path: "a:b.md", reason: "nameNotRepresentable" },
	{ path: "big.pdf", reason: "tooLarge" },
	{ path: "scratch.tmp", reason: "ignored" },
] as const;

describe("skippedCount", () => {
	it("tells how many files are skipped, in English and Russian", () => {
		expect(skippedCount(files, selectStrings("en"))).toBe("4 skipped");
		expect(skippedCount(files, selectStrings("ru"))).toBe("пропущено: 4");
	});

	it("tells nothing when no file is skipped", () => {
		expect(skippedCount([], selectStrings("en"))).toBeNull();
	});
});

describe("skippedLines", () => {
	it("gives each skipped file with its reason, in order, in English", () => {
		expect(skippedLines(files, selectStrings("en"))).toEqual([
			"Note.md differs from another file's name only in case",
			"a:b.md has a name the cloud cannot store",
			"big.pdf is larger than the size limit",
			"scratch.tmp matches the ignore list",
		]);
	});

	it("gives each skipped file with its reason in Russian", () => {
		expect(skippedLines(files, selectStrings("ru"))).toEqual([
			"Note.md отличается от имени другого файла только регистром",
			"a:b.md: облако не может сохранить такое имя",
			"big.pdf больше предельного размера",
			"scratch.tmp подходит под список исключений",
		]);
	});
});

describe("skippedLines with a limit", () => {
	const many = Array.from({ length: 25 }, (_, index) => ({
		path: `f${String(index).padStart(2, "0")}.tmp`,
		reason: "ignored" as const,
	}));

	it("gives the first files up to the limit and how many more there are", () => {
		const lines = skippedLines(many, selectStrings("en"), 20);
		expect(lines).toHaveLength(21);
		expect(lines[19]).toBe("f19.tmp matches the ignore list");
		expect(lines[20]).toBe("And 5 more");
		expect(skippedLines(many, selectStrings("ru"), 20)[20]).toBe("И ещё 5");
	});

	it("gives every file when they fit the limit", () => {
		expect(skippedLines(many.slice(0, 20), selectStrings("en"), 20)).toHaveLength(20);
	});
});
