import { describe, expect, it } from "vitest";
import { ProviderError } from "../../src/engine/provider";
import { rejection } from "../support/assertions";
import { bytes } from "../support/bytes";
import { expectFailure } from "../support/provider-failure";
import { FakeRemote } from "./fake-remote";
import { readText, readBytes } from "../support/provider-read";

describe("FakeProvider", () => {
	it("lets a device read a file another device wrote to the same Remote", async () => {
		const remote = new FakeRemote();
		await remote.openProvider().write("note.md", bytes("from laptop"));
		expect(await readText(remote.openProvider(), "note.md")).toBe("from laptop");
	});

	it("fails a device's conditional write after another device changed the file", async () => {
		const remote = new FakeRemote();
		const laptop = remote.openProvider();
		const phone = remote.openProvider();
		const { revision } = await laptop.write("note.md", bytes("one"));
		await phone.write("note.md", bytes("from phone"));
		await expectFailure(
			laptop.write("note.md", bytes("from laptop"), { kind: "revision", revision }),
			"preconditionFailed",
		);
		expect(await readText(phone, "note.md")).toBe("from phone");
	});

	it("keeps stored bytes when the caller later changes its buffers", async () => {
		const provider = new FakeRemote().openProvider();
		const written = bytes("abc");
		await provider.write("note.md", written);
		new Uint8Array(written).fill(0);
		new Uint8Array(await readBytes(provider, "note.md")).fill(0);
		expect(await readText(provider, "note.md")).toBe("abc");
	});

	it("fails a write into a folder that does not exist with notFound", async () => {
		const provider = new FakeRemote().openProvider();
		await expectFailure(provider.write("notes/a.md", bytes("a")), "notFound");
	});

	it("fails creating a folder inside a folder that does not exist with notFound", async () => {
		const provider = new FakeRemote().openProvider();
		await expectFailure(provider.createFolder("notes/daily"), "notFound");
	});

	it("refuses to write a file over a folder", async () => {
		const provider = new FakeRemote().openProvider();
		await provider.createFolder("notes");
		await expectFailure(provider.write("notes", bytes("a")), "preconditionFailed");
		expect((await provider.list()).entries).toEqual([{ kind: "folder", path: "notes" }]);
	});

	it("refuses to create a folder over a file", async () => {
		const provider = new FakeRemote().openProvider();
		await provider.write("note.md", bytes("keep me"));
		await expectFailure(provider.createFolder("note.md"), "preconditionFailed");
		expect(await readText(provider, "note.md")).toBe("keep me");
	});

	it("rejects deleting a folder that still holds entries with a plain Error", async () => {
		const provider = new FakeRemote().openProvider();
		await provider.createFolder("notes");
		await provider.write("notes/a.md", bytes("a"));
		const error = await rejection(provider.delete("notes"));
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(ProviderError);
		expect(await readText(provider, "notes/a.md")).toBe("a");
	});
});
