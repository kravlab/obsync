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
