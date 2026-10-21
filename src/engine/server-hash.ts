/**
 * Server hashes the plugin can compute itself (spec, "Remote layout and
 * change detection", "First sync"). A provider may report a hash of each
 * file, tagged with its algorithm; when the plugin knows that exact
 * algorithm, it hashes the vault file the same way and an equal value
 * proves identical content without a download. Any other algorithm
 * decides nothing.
 */
import { hex } from "./content-hash";

/**
 * SHA-256 over the SHA-256 digests of the content's 4 MiB blocks, the
 * last one possibly shorter, concatenated; an empty file has no blocks.
 */
export const BLOCK_SHA256 = "sha256-4mib-blocks";

/** The block size of `BLOCK_SHA256`, in bytes. */
const BLOCK_BYTES = 4 * 1024 * 1024;

/** Returns a function computing the server hash `algorithm` as lowercase hex, or null for one the plugin cannot compute. */
export function serverHasher(algorithm: string): ((data: ArrayBuffer) => Promise<string>) | null {
	return algorithm === BLOCK_SHA256 ? blockSha256 : null;
}

/** The `BLOCK_SHA256` hash of `data`. */
async function blockSha256(data: ArrayBuffer): Promise<string> {
	const blocks = Math.ceil(data.byteLength / BLOCK_BYTES);
	const digests = new Uint8Array(blocks * 32);
	for (let block = 0; block < blocks; block += 1) {
		const start = block * BLOCK_BYTES;
		const digest = await crypto.subtle.digest("SHA-256", data.slice(start, start + BLOCK_BYTES));
		digests.set(new Uint8Array(digest), block * 32);
	}
	return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", digests)));
}
