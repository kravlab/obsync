/**
 * The plugin's own content hash (spec, "Remote layout and change
 * detection"): what tells whether a vault file changed since the last
 * sync, and whether a downloaded file is the content already known. It is
 * the same on every device and every provider, unlike a server hash.
 */

/**
 * Returns the SHA-256 of `data` as lowercase hex. Uses Web Crypto, which
 * Obsidian has on desktop, Android and iOS. The bytes are hashed as they
 * are: a different line ending is a different hash.
 */
export async function contentHash(data: ArrayBuffer): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
