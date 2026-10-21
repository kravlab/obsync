import { describe, expect, it } from "vitest";
import { detailField, failureDetail } from "../../src/engine/failure-detail";
import { ProviderError } from "../../src/engine/provider";

describe("failure details", () => {
	it("is a provider failure's message, as the provider wrote it", () => {
		const error = new ProviderError({ category: "permanent" }, 'HTTP 400: {"error": "invalid_request"}');
		expect(failureDetail(error)).toBe('HTTP 400: {"error": "invalid_request"}');
	});

	it("is another error's name and message", () => {
		expect(failureDetail(new TypeError("x is undefined"))).toBe("TypeError: x is undefined");
	});

	it("is a thrown value that is not an error, as text", () => {
		expect(failureDetail("lost")).toBe("lost");
		expect(failureDetail(42)).toBe("42");
	});

	it("is one line: line breaks and runs of spaces become one space, ends trimmed", () => {
		const error = new ProviderError({ category: "permanent" }, "  HTTP 400:\r\n  Error in call\n\tto API  ");
		expect(failureDetail(error)).toBe("HTTP 400: Error in call to API");
	});

	it("is cut to the limit, ending in an ellipsis", () => {
		const detail = failureDetail(new ProviderError({ category: "permanent" }, "a".repeat(400)));
		expect(detail).toBe(`${"a".repeat(299)}…`);
		expect(detail.length).toBe(300);
	});

	it("counts characters, never cutting one in half", () => {
		const detail = failureDetail(new ProviderError({ category: "permanent" }, `${"a".repeat(298)}😀😀😀`));
		expect(detail).toBe(`${"a".repeat(298)}😀…`);
		expect(Array.from(detail)).toHaveLength(300);
	});

	it("keeps a detail exactly at the limit whole", () => {
		expect(failureDetail(new ProviderError({ category: "permanent" }, "b".repeat(300)))).toBe("b".repeat(300));
	});

	it("is empty for a provider failure without a message", () => {
		expect(failureDetail(new ProviderError({ category: "permanent" }, ""))).toBe("");
	});

	it("is carried as a detail field, or as no field when empty", () => {
		expect(detailField(new TypeError("x"))).toEqual({ detail: "TypeError: x" });
		expect(Object.keys(detailField(new ProviderError({ category: "permanent" }, " ")))).toEqual([]);
	});
});
