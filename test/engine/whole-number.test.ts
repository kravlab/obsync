import { describe, expect, it } from "vitest";
import { isWholeNumberIn, parseWholeNumber } from "../../src/engine/whole-number";

describe("typed whole numbers", () => {
	it("takes digits within the range, surrounding spaces allowed, bounds included", () => {
		expect(parseWholeNumber("1", 1, 10)).toBe(1);
		expect(parseWholeNumber(" 10 ", 1, 10)).toBe(10);
	});

	it("refuses a number outside the range, a sign, a decimal, an exponent or a unit", () => {
		for (const typed of ["0", "11", "", " ", "+5", "-5", "5.0", "1e1", "5 s", "abc"]) {
			expect(parseWholeNumber(typed, 1, 10), typed).toBeNull();
		}
	});

	it("tells whether a number is whole and within the range", () => {
		expect(isWholeNumberIn(1, 1, 10)).toBe(true);
		expect(isWholeNumberIn(10, 1, 10)).toBe(true);
		expect(isWholeNumberIn(0, 1, 10)).toBe(false);
		expect(isWholeNumberIn(11, 1, 10)).toBe(false);
		expect(isWholeNumberIn(2.5, 1, 10)).toBe(false);
		expect(isWholeNumberIn(Number.NaN, 1, 10)).toBe(false);
	});
});
