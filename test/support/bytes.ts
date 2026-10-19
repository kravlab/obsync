/** Encodes text as UTF-8 into a fresh ArrayBuffer, as file content. */
export function bytes(text: string): ArrayBuffer {
	const encoded = new TextEncoder().encode(text);
	return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
}

/** Decodes UTF-8 file content back to text. */
export function text(data: ArrayBuffer): string {
	return new TextDecoder().decode(data);
}

/** `size` bytes counting up and wrapping at 251, so a misplaced part shows. */
export function patterned(size: number): ArrayBuffer {
	return Uint8Array.from({ length: size }, (_, index) => index % 251).buffer;
}
