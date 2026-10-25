import { describe, expect, it, vi } from "vitest";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { syncNow, withStartedEngine } from "../support/sync";

describe("an automatic sync that hits a bug", () => {
	it("reports the error through the engine's port instead of leaving it unhandled, and shows Sync failed", async () => {
		const laptop = connectTestDevice(new FakeRemote(), "Laptop");
		await laptop.vault.write("note.md", bytes("v1"));
		await syncNow(laptop);
		const bug = new TypeError("boom");

		await withStartedEngine(laptop, async () => {
			vi.spyOn(laptop.vault, "list").mockRejectedValue(bug);
			// The next poll runs a sync no caller waits for.
			laptop.scheduler.advance(laptop.schedule.pollInterval.ms);
			await vi.waitFor(() => expect(laptop.errors).toEqual([bug]));
		});

		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed", cause: "bug", detail: "TypeError: boom" });
	});
});
