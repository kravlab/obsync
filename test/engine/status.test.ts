import { describe, expect, it } from "vitest";
import { statusOf } from "../../src/engine/status";

describe("sync status of a Connection", () => {
	it("is Not connected without a Connection", () => {
		expect(statusOf(null)).toEqual({ state: "notConnected" });
	});

	it("is Connected with a Connection", () => {
		const connection = { accountId: "account", remoteRoot: "My vault", device: { id: "id", name: "Laptop" } };
		expect(statusOf(connection)).toEqual({ state: "connected" });
	});
});
