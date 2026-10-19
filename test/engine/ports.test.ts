import { describe, expect, it } from "vitest";
import { providerSecretId } from "../../src/engine/ports";

describe("providerSecretId", () => {
	it("prefixes the provider id with the plugin id", () => {
		expect(providerSecretId("dropbox")).toBe("obsync-dropbox");
	});
});
