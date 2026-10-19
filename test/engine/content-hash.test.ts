import { describe, expect, it } from "vitest";
import { contentHash } from "../../src/engine/content-hash";
import { bytes } from "../support/bytes";

// Expected values are the SHA-256 test vectors of FIPS 180-2 and the
// well-known digest of empty input.
describe("contentHash", () => {
	it("is the lowercase hex SHA-256 of the bytes", async () => {
		expect(await contentHash(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});

	it("hashes an empty file", async () => {
		expect(await contentHash(new ArrayBuffer(0))).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("differs for bytes that differ only in line endings", async () => {
		expect(await contentHash(bytes("a\r\n"))).not.toBe(await contentHash(bytes("a\n")));
	});
});
