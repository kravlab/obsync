import { describe, expect, it } from "vitest";
import { InMemorySecretStore } from "./test-device";

describe("InMemorySecretStore", () => {
	it("returns null for a secret never set", () => {
		expect(new InMemorySecretStore().getSecret("dropbox")).toBeNull();
	});

	it("returns the latest secret set under an id, keeping ids apart", () => {
		const store = new InMemorySecretStore();
		store.setSecret("dropbox", "old");
		store.setSecret("dropbox", "new");
		store.setSecret("other", "kept");
		expect(store.getSecret("dropbox")).toBe("new");
		expect(store.getSecret("other")).toBe("kept");
	});
});
