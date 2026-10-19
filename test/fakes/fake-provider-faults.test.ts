import { describe, expect, it } from "vitest";
import type { ChangeFeed } from "../../src/engine/provider";
import { rejection, reported } from "../support/assertions";
import { bytes, text } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { SimulatedCrash } from "./fake-provider";
import { FakeRemote } from "./fake-remote";

describe("FakeProvider fault injection", () => {
	it("fails the next matching operation with throttled and its retry delay, then recovers", async () => {
		const provider = new FakeRemote().openProvider();
		await provider.write("note.md", bytes("a"));
		provider.failNext("read", { category: "throttled", retryAfterMs: 30_000 });
		const error = await rejection(provider.read("note.md"));
		expect(error).toMatchObject({ failure: { category: "throttled", retryAfterMs: 30_000 } });
		expect(text(await provider.read("note.md"))).toBe("a");
	});

	it("fails a write with transient without storing anything", async () => {
		const provider = new FakeRemote().openProvider();
		provider.failNext("write", { category: "transient" });
		await expectFailure(provider.write("note.md", bytes("a")), "transient");
		expect((await provider.list()).entries).toEqual([]);
	});

	it("fails the change feed with cursorLost on a cursor it issued", async () => {
		const provider = new FakeRemote({ changeFeed: true }).openProvider();
		const { cursor } = await provider.list();
		provider.failNext("changes", { category: "cursorLost" });
		const feed = reported<ChangeFeed>(provider.capabilities.changeFeed);
		await expectFailure(feed.changes(cursor ?? ""), "cursorLost");
	});

	it("lets another device write just before the next write, so a conditional write fails", async () => {
		const remote = new FakeRemote();
		const laptop = remote.openProvider();
		const phone = remote.openProvider();
		const { revision } = await laptop.write("note.md", bytes("one"));
		laptop.beforeNext("write", async () => {
			await phone.write("note.md", bytes("from phone"));
		});
		await expectFailure(
			laptop.write("note.md", bytes("from laptop"), { kind: "revision", revision }),
			"preconditionFailed",
		);
		expect(text(await laptop.read("note.md"))).toBe("from phone");
	});

	it("injects faults into one device only", async () => {
		const remote = new FakeRemote();
		const laptop = remote.openProvider();
		const phone = remote.openProvider();
		laptop.failNext("write", { category: "transient" });
		await phone.write("note.md", bytes("phone"));
		expect(text(await laptop.read("note.md"))).toBe("phone");
	});
});

describe("FakeProvider crashes", () => {
	it("crashes before the Nth operation, leaving it undone", async () => {
		const provider = new FakeRemote().openProvider();
		provider.crashBefore(2);
		await provider.write("first.md", bytes("1"));
		await expect(provider.write("second.md", bytes("2"))).rejects.toBeInstanceOf(SimulatedCrash);
		expect((await provider.list()).entries.map((entry) => entry.path)).toEqual(["first.md"]);
	});

	it("crashes after the Nth operation, which took effect but returned nothing", async () => {
		const provider = new FakeRemote().openProvider();
		provider.crashAfter(1);
		await expect(provider.write("note.md", bytes("landed"))).rejects.toBeInstanceOf(SimulatedCrash);
		expect(text(await provider.read("note.md"))).toBe("landed");
	});
});
