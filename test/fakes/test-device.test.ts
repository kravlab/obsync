import { describe, expect, it } from "vitest";
import { InMemoryDeviceStore, InMemorySecretStore } from "./test-device";

describe("InMemoryDeviceStore", () => {
	it("stores, replaces and clears the Remote feed state", async () => {
		const store = new InMemoryDeviceStore();
		expect(await store.loadRemoteFeed()).toBeNull();
		const feed = {
			cursor: "c1",
			namePolicy: "skipAndReport" as const,
			entries: [{ kind: "file" as const, path: "a.md", revision: "r1", size: 1 }],
		};
		await store.saveRemoteFeed(feed);
		expect(await store.loadRemoteFeed()).toEqual(feed);
		await store.clear();
		expect(await store.loadRemoteFeed()).toBeNull();
	});
});

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
