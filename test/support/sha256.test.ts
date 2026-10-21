import { describe, expect, it } from "vitest";
import { bytes } from "./bytes";
import { sha256Hex } from "./sha256";

describe("the synchronous SHA-256 for test fakes", () => {
	// Expected values computed with openssl.
	it("hashes the empty input, one block and inputs across block boundaries", () => {
		expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(sha256Hex(new Uint8Array(bytes("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(sha256Hex(new Uint8Array(bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
			"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
		);
		expect(sha256Hex(new Uint8Array(1000).fill(0x61))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
	});
});
