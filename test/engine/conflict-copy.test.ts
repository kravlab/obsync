import { describe, expect, it } from "vitest";
import { conflictCopyPath, isConflictCopy } from "../../src/engine/conflict-copy";

/** 2026-10-20 14:30:45 on the test machine's own clock, the local time a copy name shows. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30, 45).getTime();

/** 2026-03-05 09:07 local time, with single-digit fields. */
const MORNING = new Date(2026, 2, 5, 9, 7).getTime();

describe("conflictCopyPath", () => {
	it("names the copy after the device and the local time, before the extension, in the same folder", () => {
		expect(conflictCopyPath("photos/Photo.png", "Phone", AFTERNOON)).toBe(
			"photos/Photo (conflict Phone 2026-10-20 1430).png",
		);
	});

	it("pads month, day, hour and minute to two digits", () => {
		expect(conflictCopyPath("Scan.pdf", "Laptop", MORNING)).toBe("Scan (conflict Laptop 2026-03-05 0907).pdf");
	});

	it("splits at the last dot of the file's own name, not at a dot in a folder", () => {
		expect(conflictCopyPath("v1.2/archive.tar.gz", "Phone", AFTERNOON)).toBe(
			"v1.2/archive.tar (conflict Phone 2026-10-20 1430).gz",
		);
	});

	it("adds no extension to a name without one", () => {
		expect(conflictCopyPath("docs/LICENSE", "Phone", AFTERNOON)).toBe("docs/LICENSE (conflict Phone 2026-10-20 1430)");
	});

	it("takes a name starting with its only dot as a name without an extension", () => {
		expect(conflictCopyPath(".hidden", "Phone", AFTERNOON)).toBe(".hidden (conflict Phone 2026-10-20 1430)");
	});

	it("leaves a copy name that fits the longest name as it is", () => {
		expect(conflictCopyPath("Photo.png", "Phone", AFTERNOON, 1, 255)).toBe("Photo (conflict Phone 2026-10-20 1430).png");
	});

	it("shortens the original name's stem so the copy fits the longest name, keeping the suffix and extension", () => {
		const copy = conflictCopyPath(`photos/${"x".repeat(250)}.png`, "Phone", AFTERNOON, 1, 255);
		const name = copy.slice("photos/".length);

		expect(name).toHaveLength(255);
		expect(name.endsWith(" (conflict Phone 2026-10-20 1430).png")).toBe(true);
		expect(isConflictCopy(copy)).toBe(true);
	});

	it("shortens the device name once the stem is down to one character", () => {
		const copy = conflictCopyPath("A.png", "D".repeat(300), AFTERNOON, 2, 255);

		expect(copy).toHaveLength(255);
		expect(copy.startsWith("A (conflict DDD")).toBe(true);
		expect(copy.endsWith("D 2026-10-20 1430 2).png")).toBe(true);
		expect(isConflictCopy(copy)).toBe(true);
	});

	it("never cuts a character made of two UTF-16 units in half", () => {
		// " (conflict Phones 2026-10-20 1430).png" takes 38 units, leaving an odd 217 for the stem.
		const copy = conflictCopyPath(`${"😀".repeat(200)}.png`, "Phones", AFTERNOON, 1, 255);

		expect(copy).toHaveLength(254);
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(copy)).toBe(false);
	});

	it("never cuts a character the user sees as one, such as joined emoji", () => {
		const family = "👨‍👩‍👧";
		const copy = conflictCopyPath(`${family.repeat(40)}.png`, "Phone", AFTERNOON, 1, 255);
		const stem = copy.slice(0, copy.indexOf(" (conflict "));

		expect(copy.length).toBeLessThanOrEqual(255);
		expect(stem.length).toBeGreaterThan(0);
		expect(stem.replaceAll(family, "")).toBe("");
	});

	it("shortens the extension too, from its end, once stem and device name are down to one character", () => {
		const copy = conflictCopyPath(`Chapter 1. ${"z".repeat(240)}`, "Phone", AFTERNOON, 1, 255);

		expect(copy).toHaveLength(255);
		expect(copy.startsWith("C (conflict P 2026-10-20 1430). zzz")).toBe(true);
		expect(isConflictCopy(copy)).toBe(true);
	});

	it("replaces characters a file name cannot hold in the device name with a dash", () => {
		expect(conflictCopyPath("Photo.png", 'a/b\\c:d*e?f"g<h>i|j\u0007k', AFTERNOON)).toBe(
			"Photo (conflict a-b-c-d-e-f-g-h-i-j-k 2026-10-20 1430).png",
		);
	});

	it("numbers a copy from 2 inside the parentheses", () => {
		expect(conflictCopyPath("Photo.png", "Phone", AFTERNOON, 2)).toBe("Photo (conflict Phone 2026-10-20 1430 2).png");
		expect(conflictCopyPath("LICENSE", "Phone", AFTERNOON, 3)).toBe("LICENSE (conflict Phone 2026-10-20 1430 3)");
	});

	it("gives the first copy no number", () => {
		expect(conflictCopyPath("Photo.png", "Phone", AFTERNOON, 1)).toBe(conflictCopyPath("Photo.png", "Phone", AFTERNOON));
	});
});

describe("isConflictCopy", () => {
	it("recognises a Conflict copy by its name, with or without an extension", () => {
		expect(isConflictCopy("photos/Photo (conflict Phone 2026-10-20 1430).png")).toBe(true);
		expect(isConflictCopy("docs/LICENSE (conflict Phone 2026-10-20 1430)")).toBe(true);
	});

	it("recognises a numbered Conflict copy", () => {
		expect(isConflictCopy("Photo (conflict Phone 2026-10-20 1430 2).png")).toBe(true);
	});

	it("recognises a copy whose device name holds spaces and parentheses", () => {
		expect(isConflictCopy("Photo (conflict Work (old) laptop 2026-10-20 1430).png")).toBe(true);
	});

	it("does not take an ordinary file for a Conflict copy", () => {
		expect(isConflictCopy("photos/Photo.png")).toBe(false);
		expect(isConflictCopy("Meeting (2026-10-20 1430).md")).toBe(false);
		expect(isConflictCopy("Photo (conflict Phone).png")).toBe(false);
		expect(isConflictCopy("Photo (conflict Phone 2026-10-20 14:30).png")).toBe(false);
	});

	it("looks only at the file's own name, not at a folder named like a copy", () => {
		expect(isConflictCopy("Photo (conflict Phone 2026-10-20 1430)/Photo.png")).toBe(false);
	});

	it("recognises every name conflictCopyPath gives", () => {
		expect(isConflictCopy(conflictCopyPath("v1.2/archive.tar.gz", 'a/b:c', MORNING, 4))).toBe(true);
	});
});
