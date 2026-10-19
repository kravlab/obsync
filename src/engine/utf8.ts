/**
 * Strict UTF-8 decoding, shared by everything that must tell text from
 * bytes that are not (spec, "Text merge", what counts as text).
 */

/**
 * `data` decoded as UTF-8 without a leading byte-order mark, or null if it
 * is not valid UTF-8.
 */
export function decodeUtf8(data: ArrayBuffer): string | null {
	try {
		// A fatal decoder throws on bytes that are not UTF-8; it drops a leading byte-order mark.
		return new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch {
		return null;
	}
}

/** The UTF-8 byte-order mark. */
const BOM = [0xef, 0xbb, 0xbf] as const;

/** Whether `data` starts with the UTF-8 byte-order mark. */
export function hasByteOrderMark(data: ArrayBuffer): boolean {
	const head = new Uint8Array(data, 0, Math.min(BOM.length, data.byteLength));
	return BOM.every((byte, index) => head[index] === byte);
}
