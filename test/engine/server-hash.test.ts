import { describe, expect, it } from "vitest";
import { BLOCK_SHA256, serverHasher } from "../../src/engine/server-hash";
import { bytes } from "../support/bytes";

/** `count` bytes of the letter a. */
function letters(count: number): ArrayBuffer {
	return new Uint8Array(count).fill(0x61).buffer;
}

describe("server hashes the plugin computes itself", () => {
	// Expected values computed with openssl, following Dropbox's content hash reference.
	const hash = serverHasher(BLOCK_SHA256);

	it("hashes an empty file as the SHA-256 of no block digests", async () => {
		expect(await hash?.(new ArrayBuffer(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});

	it("hashes a file of one block as the SHA-256 of its block's digest", async () => {
		expect(await hash?.(bytes("abc"))).toBe("4f8b42c22dd3729b519ba6f68d2da7cc5b2d606d05daed5ad5128cc03e6c6358");
		expect(await hash?.(letters(4 * 1024 * 1024))).toBe(
			"907a506cf5e706bda5c7a29b43c9c65d8344bd2fa2f22339b359c214812af5a1",
		);
	});

	it("hashes a file of several 4 MiB blocks, the last one shorter", async () => {
		expect(await hash?.(letters(4 * 1024 * 1024 + 1))).toBe(
			"5f858b62ccd88447586305aec6fd53c96747cfebf527cbba129a6dfed47d9624",
		);
	});

	it("knows no other algorithm", () => {
		expect(serverHasher("md5")).toBeNull();
	});
});
