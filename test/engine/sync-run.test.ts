import { describe, expect, it, vi } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { isWithin } from "../../src/engine/paths";
import { METADATA_FOLDER } from "../../src/engine/remote-metadata";
import { SimulatedCrash } from "../fakes/fake-provider";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { mirror, remoteText, syncNow, vaultText } from "../support/sync";
import { EXHAUSTIVE_TEST_TIMEOUT_MS } from "../support/timeouts";

describe("local change detection by mtime and size", () => {
	it("skips reading and hashing untouched vault files on later syncs, while uploading files edited while closed", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("untouched.md", bytes("stay"));
		await laptop.vault.write("edited.md", bytes("v1"));
		await syncNow(laptop);

		// Edited while Obsidian was closed: same byte length, newer mtime.
		laptop.clock.advance(5_000);
		await laptop.vault.write("edited.md", bytes("v2"));
		const readSpy = vi.spyOn(laptop.vault, "read");

		await syncNow(laptop);

		expect(readSpy.mock.calls.map(([path]) => path)).toEqual(["edited.md"]);
		expect(remoteText(remote, "edited.md")).toBe("v2");
	});

	it("uploads on the next sync an edit saved while the earlier version was uploading", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("v1"));
		laptop.provider.beforeNext("write", async () => {
			laptop.clock.advance(1_000);
			await laptop.vault.write("note.md", bytes("v2, saved during the upload"));
		});

		await syncNow(laptop);
		await syncNow(laptop);

		expect(remoteText(remote, "note.md")).toBe("v2, saved during the upload");
	});

	it("uploads on the next sync an edit saved while a Remote edit was downloading", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("note.md", bytes("v1"));
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.write("note.md", bytes("v2 from the laptop"));
		await syncNow(laptop);
		phone.provider.beforeNextRead("note.md", async () => {
			// The download is written, then the user saves again before the sync records it.
			phone.vault.afterNextWrite("note.md", async () => {
				phone.clock.advance(1_000);
				await phone.vault.write("note.md", bytes("v3 from the phone"));
			});
		});

		await syncNow(phone);
		await syncNow(phone);

		expect(remoteText(remote, "note.md")).toBe("v3 from the phone");
	});
});

describe("Remote change feed and full reconcile", () => {
	it("uses changeFeed.changes after the first sync instead of listing the Remote again", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("a.md", bytes("v1"));
		await syncNow(laptop);
		await syncNow(phone);

		await laptop.vault.write("a.md", bytes("v2"));
		await laptop.vault.write("b.md", bytes("new"));
		await syncNow(laptop);

		// If phone called list() instead of changes(), this fault would fail the sync.
		phone.provider.failNext("list", { category: "permanent" });
		await syncNow(phone);

		expect(await vaultText(phone, "a.md")).toBe("v2");
		expect(await vaultText(phone, "b.md")).toBe("new");
	});

	it("falls back to a full listing when the change-feed cursor is lost", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("a.md", bytes("v1"));
		await syncNow(laptop);
		await syncNow(phone);

		await laptop.vault.write("a.md", bytes("v2"));
		await syncNow(laptop);
		const changesSpy = vi.spyOn(phone.provider.capabilities.changeFeed!, "changes");
		phone.provider.failNext("changes", { category: "cursorLost" });

		await syncNow(phone);

		expect(changesSpy).toHaveBeenCalledOnce();
		expect(await vaultText(phone, "a.md")).toBe("v2");
	});

	it("lists the Remote in full when reconcile is requested", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("a.md", bytes("v1"));
		await syncNow(laptop);
		await syncNow(phone);

		await laptop.vault.write("a.md", bytes("v2"));
		await syncNow(laptop);
		// If reconcile used changes(), this fault would fail the sync.
		phone.provider.failNext("changes", { category: "permanent" });

		await createSyncEngine(phone.ports).reconcile();

		expect(phone.ui.lastStatus).toEqual({ state: "synced" });
		expect(await vaultText(phone, "a.md")).toBe("v2");
	});

	it("downloads a Remote edit on the next sync after the post-edit pause, even with no newer Remote changes", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await laptop.vault.write("note.md", bytes("line 1\nline 2"));
		await syncNow(laptop);
		await syncNow(phone);

		await laptop.vault.write("note.md", bytes("line 1\nline 2\nfrom laptop"));
		await syncNow(laptop);
		await phone.vault.typeInto("note.md", bytes("from phone\nline 1\nline 2"));

		// First sync on phone happens during the post-edit pause: note.md is skipped.
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("from phone\nline 1\nline 2");

		// Pause passes; no further changes happen on the Remote.
		phone.clock.advance(5_000);
		phone.provider.failNext("list", { category: "permanent" });
		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("from phone\nline 1\nline 2\nfrom laptop");
	});
});

describe("order of work", () => {
	it("uploads small text before larger text, text before attachments, and all uploads before downloads", async () => {
		const remote = new FakeRemote();
		const setup = remote.openProvider();
		await setup.write("incoming.md", bytes("from remote"));
		const laptop = connectTestDevice(remote, "Laptop");

		await laptop.vault.write("large-attachment.bin", new Uint8Array(50).buffer);
		await laptop.vault.write("small-attachment.png", new Uint8Array(10).buffer);
		await laptop.vault.write("longer.md", bytes("a longer text note"));
		await laptop.vault.write("short.md", bytes("hi"));
		const before = remote.cursor();
		/** The vault paths written to the Remote since `before`, in the order they were written; the Metadata folder aside. */
		const written = (): string[] =>
			(remote.changesSince(before)?.changes ?? []).map((change) => change.path).filter((path) => !isWithin(path, METADATA_FOLDER));
		let writtenWhenDownloading: string[] = [];
		laptop.vault.beforeNextWrite("incoming.md", () => {
			writtenWhenDownloading = written();
			return Promise.resolve();
		});

		await syncNow(laptop);

		const uploads = ["short.md", "longer.md", "small-attachment.png", "large-attachment.bin"];
		expect(written()).toEqual(uploads);
		expect(writtenWhenDownloading).toEqual(uploads);
		expect(await vaultText(laptop, "incoming.md")).toBe("from remote");
	});
});

describe("interruption safety across every step", () => {
	it(
		"completes the work on the next sync after crashing before or after any step: provider calls, vault writes and Device store saves",
		async () => {
			for (const when of ["before", "after"] as const) {
				let reachedCompletion = false;
				for (let step = 1; step <= 200 && !reachedCompletion; step += 1) {
					const remote = new FakeRemote({ changeFeed: true });
					const laptop = connectTestDevice(remote, "Laptop");
					const phone = connectTestDevice(remote, "Phone");

					await laptop.vault.write("shared.md", bytes("line 1\nline 2"));
					await syncNow(laptop);
					await syncNow(phone);

					// Remote has a change to shared.md and a new file in a folder.
					await laptop.vault.write("shared.md", bytes("line 1\nline 2\nfrom laptop"));
					await laptop.vault.createFolder("remote-dir");
					await laptop.vault.write("remote-dir/doc.md", bytes("remote doc"));
					await syncNow(laptop);

					// Phone has a concurrent edit to shared.md, a new folder + note, and a binary file.
					await phone.vault.write("shared.md", bytes("from phone\nline 1\nline 2"));
					await phone.vault.createFolder("local-dir");
					await phone.vault.write("local-dir/note.md", bytes("local note"));
					await phone.vault.write("image.png", bytes("png-bytes"));

					if (when === "before") phone.crash.crashBefore(step);
					else phone.crash.crashAfter(step);

					const outcome = await syncNow(phone).then(
						() => "completed" as const,
						(error: unknown) => error,
					);
					if (outcome === "completed") {
						// Past the last step: every step before it crashed once.
						reachedCompletion = true;
						continue;
					}
					expect(outcome).toBeInstanceOf(SimulatedCrash);

					// Next sync on a fresh engine over the same device stores finishes everything.
					await syncNow(phone);
					await syncNow(laptop);

					expect(await vaultText(phone, "shared.md")).toBe("from phone\nline 1\nline 2\nfrom laptop");
					expect(await vaultText(laptop, "shared.md")).toBe("from phone\nline 1\nline 2\nfrom laptop");
					expect(await vaultText(phone, "remote-dir/doc.md")).toBe("remote doc");
					expect(await vaultText(laptop, "local-dir/note.md")).toBe("local note");
					expect(remoteText(remote, "image.png")).toBe("png-bytes");
					expect(
						mirror(remote)
							.map((entry) => entry.path)
							.sort(),
					).toEqual(["image.png", "local-dir", "local-dir/note.md", "remote-dir", "remote-dir/doc.md", "shared.md"]);
				}
				expect(reachedCompletion, `a sync crashing ${when} step 200 never completed`).toBe(true);
			}
		},
		EXHAUSTIVE_TEST_TIMEOUT_MS,
	);
});

describe("an edit size and mtime cannot see", () => {
	it("merges a Remote edit with a vault edit that kept the file's size and mtime, instead of stalling", async () => {
		const remote = new FakeRemote();
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		// Uploaded from the phone, so the phone records the note's size and mtime.
		await phone.vault.write("note.md", bytes("one\nkeep\nthree\n"));
		await syncNow(phone);
		await syncNow(laptop);
		await phone.vault.writeKeepingMtime("note.md", bytes("ONE\nkeep\nthree\n"));
		await laptop.vault.write("note.md", bytes("one\nkeep\nTHREE\n"));
		await syncNow(laptop);

		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("ONE\nkeep\nTHREE\n");
		expect(remoteText(remote, "note.md")).toBe("ONE\nkeep\nTHREE\n");
	});
});

describe("the change feed against a full listing", () => {
	it("drops a folder's children when the feed reports a file in its place", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.createFolder("a");
		await laptop.vault.write("a/x.md", bytes("x"));
		await laptop.vault.write("other.md", bytes("other"));
		await syncNow(laptop);
		// The second sync moves the stored cursor past the laptop's own uploads.
		await syncNow(laptop);
		remote.replaceFolder("a", { kind: "file", data: bytes("now a file"), revision: remote.nextRevision() });

		await syncNow(laptop);

		const fed = laptop.deviceStore.remoteFeed?.entries.map((entry) => entry.path).sort();
		expect(fed).toEqual(
			remote
				.list()
				.map((entry) => entry.path)
				.sort(),
		);
	});
});

describe("listing the Remote", () => {
	it("lists again once when the listing's cursor is reset while paging", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));
		laptop.provider.failNext("list", { category: "cursorLost" });

		await syncNow(laptop);

		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteText(remote, "note.md")).toBe("note");
	});

	it("saves the change-feed state only when its cursor moved", async () => {
		const remote = new FakeRemote({ changeFeed: true });
		const laptop = connectTestDevice(remote, "Laptop");
		await laptop.vault.write("note.md", bytes("note"));
		await syncNow(laptop);
		await syncNow(laptop);
		const saves = vi.spyOn(laptop.deviceStore, "saveRemoteFeed");

		await syncNow(laptop);

		expect(saves).not.toHaveBeenCalled();
	});
});
