import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { onePixelPng } from "./png";

/** The CRC-32 of `bytes`, bit by bit as the PNG specification defines it, to check the PNG's own against. */
function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** The chunks of `png` after its signature, each with whether its CRC is right. */
function chunks(png: Uint8Array): { type: string; data: Buffer; crcRight: boolean }[] {
	const bytes = Buffer.from(png);
	const found = [];
	for (let at = 8; at < bytes.length;) {
		const length = bytes.readUInt32BE(at);
		const type = bytes.toString("latin1", at + 4, at + 8);
		const data = bytes.subarray(at + 8, at + 8 + length);
		const crcRight = bytes.readUInt32BE(at + 8 + length) === crc32(new Uint8Array(bytes.subarray(at + 4, at + 8 + length)));
		found.push({ type, data, crcRight });
		at += 12 + length;
	}
	return found;
}

describe("a one-pixel PNG", () => {
	const png = onePixelPng([200, 30, 7]);

	it("starts with the PNG signature, so it is not UTF-8 text", () => {
		expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(() => new TextDecoder("utf-8", { fatal: true }).decode(png)).toThrow();
	});

	it("holds IHDR, IDAT and IEND, in that order, each with its right CRC", () => {
		expect(chunks(png).map(({ type, crcRight }) => [type, crcRight])).toEqual([
			["IHDR", true],
			["IDAT", true],
			["IEND", true],
		]);
	});

	it("is 1 × 1 pixel of 8-bit RGB", () => {
		const header = chunks(png)[0]?.data;
		expect(header && [header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9]]).toEqual([1, 1, 8, 2]);
	});

	it("holds the given colour, after the row's filter byte", () => {
		const data = chunks(png)[1]?.data;
		expect(data && [...inflateSync(new Uint8Array(data))]).toEqual([0, 200, 30, 7]);
	});

	it("differs for another colour", () => {
		expect([...onePixelPng([0, 0, 255])]).not.toEqual([...png]);
	});
});
