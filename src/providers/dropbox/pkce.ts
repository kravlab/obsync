/**
 * PKCE for the paste-the-code login (RFC 7636; spec, "Dropbox provider"):
 * a random verifier kept in memory for one login, and its S256 challenge
 * sent in the authorize URL.
 */

/** A verifier and the challenge derived from it. */
export interface Pkce {
	readonly verifier: string;
	readonly challenge: string;
}

/**
 * Creates a new PKCE pair: a verifier of 32 random bytes in unpadded
 * base64url (43 characters, inside RFC 7636's 43–128), and its challenge,
 * the unpadded base64url SHA-256 of the verifier. Uses Web Crypto, which
 * Obsidian has on desktop, Android and iOS.
 */
export async function createPkce(): Promise<Pkce> {
	const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Unpadded base64url of `bytes`. */
function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
