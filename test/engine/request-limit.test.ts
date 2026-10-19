import { describe, expect, it } from "vitest";
import { DEFAULT_REQUEST_LIMIT, parseRequestLimit } from "../../src/engine/request-limit";

describe("Per-request limit", () => {
	it("starts at 16 MiB", () => {
		expect(DEFAULT_REQUEST_LIMIT).toEqual({ mebibytes: 16, bytes: 16_777_216 });
	});

	it("takes a typed whole number of MiB from 1 to 19", () => {
		expect(parseRequestLimit("1")).toEqual({ mebibytes: 1, bytes: 1_048_576 });
		expect(parseRequestLimit(" 19 ")).toEqual({ mebibytes: 19, bytes: 19_922_944 });
	});

	it("refuses a typed limit of 20 MiB or more, of zero, or not a whole number", () => {
		for (const typed of ["20", "0", "", "abc", "8.5", "-4", "1e1", "16 MB"]) {
			expect(parseRequestLimit(typed), typed).toBeNull();
		}
	});
});
