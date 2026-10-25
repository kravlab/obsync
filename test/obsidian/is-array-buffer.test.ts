// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isArrayBuffer } from "../../src/obsidian/is-array-buffer";

describe("isArrayBuffer", () => {
	it("knows an ArrayBuffer of this realm and one structured-cloned elsewhere", () => {
		expect(isArrayBuffer(new ArrayBuffer(2))).toBe(true);
		expect(isArrayBuffer(structuredClone(new ArrayBuffer(2)))).toBe(true);
	});

	it("takes a view, a shared buffer, plain data or nothing for no ArrayBuffer", () => {
		expect(isArrayBuffer(new Uint8Array(2))).toBe(false);
		expect(isArrayBuffer(new SharedArrayBuffer(2))).toBe(false);
		expect(isArrayBuffer({ byteLength: 2 })).toBe(false);
		expect(isArrayBuffer("bytes")).toBe(false);
		expect(isArrayBuffer(null)).toBe(false);
	});
});
