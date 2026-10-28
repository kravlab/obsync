// Images for the runs: a real PNG, so Obsidian takes it for an image, made
// here rather than kept as a binary fixture.
import { deflateSync, gzipSync } from "node:zlib";

/** The eight bytes every PNG starts with. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `parts` one after another. */
function concat(parts: readonly ArrayLike<number>[]): Uint8Array {
	const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let at = 0;
	for (const part of parts) {
		joined.set(part, at);
		at += part.length;
	}
	return joined;
}

/** `value` as four big-endian bytes, as PNG writes numbers. */
function uint32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value);
	return bytes;
}

/**
 * The CRC-32 of `bytes`, as PNG and gzip both use it, read from the gzip
 * trailer: Node's own `crc32` is missing from the typings this project has.
 */
function crc32(bytes: Uint8Array): number {
	const gzipped = gzipSync(bytes);
	return new DataView(gzipped.buffer, gzipped.byteOffset, gzipped.byteLength).getUint32(gzipped.byteLength - 8, true);
}

/** One PNG chunk: its length, type, data and the CRC of type and data. */
function chunk(type: string, data: ArrayLike<number>): Uint8Array {
	const typed = concat([new TextEncoder().encode(type), data]);
	return concat([uint32(data.length), typed, uint32(crc32(typed))]);
}

/** A PNG of one pixel of colour `rgb`, 8-bit RGB: not UTF-8 text, as an image is not. */
export function onePixelPng([red, green, blue]: readonly [number, number, number]): Uint8Array {
	// Width 1, height 1, 8 bits per sample, colour type 2 (RGB), then compression, filter and interlace 0.
	const header = concat([uint32(1), uint32(1), [8, 2, 0, 0, 0]]);
	// The row's filter byte (0, none), then the pixel.
	const pixels = deflateSync(new Uint8Array([0, red, green, blue]));
	return concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", [])]);
}
