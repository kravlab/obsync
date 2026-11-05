import { describe, expect, it } from "vitest";
import { createSyncEngine } from "../../src/engine/engine";
import { FakeRemote } from "../fakes/fake-remote";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { forgetNotices, mirror, remoteText, syncNow, vaultText } from "../support/sync";

/**
 * A Remote with a laptop and a phone that both hold `note.md` as
 * `content`, synced, plus `keep.md`, which no test deletes, so deleting
 * the note stays under the Deletion guard's thresholds.
 */
async function syncedPair(
	content: string,
	remote = new FakeRemote(),
): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	await laptop.vault.write("note.md", bytes(content));
	await laptop.vault.write("keep.md", bytes("kept"));
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}

describe("deleting a file on one device", () => {
	it("deletes it on the Remote, then moves it to the other device's trash", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.trash("note.md");

		await syncNow(laptop);
		expect(remote.get("note.md")).toBeUndefined();
		await syncNow(phone);

		expect(await phone.vault.stat("note.md")).toBeNull();
		expect(phone.vault.trashed).toEqual(["note.md"]);
		expect(phone.deviceStore.snapshot.has("note.md")).toBe(false);
		expect(laptop.deviceStore.snapshot.has("note.md")).toBe(false);
		expect(await vaultText(phone, "keep.md")).toBe("kept");
		expect([...laptop.ui.notices, ...phone.ui.notices]).toEqual([]);
	});

	it("forgets a file deleted on both devices, trashing nothing more", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.trash("note.md");
		await phone.vault.trash("note.md");

		await syncNow(laptop);
		await syncNow(phone);

		expect(remote.get("note.md")).toBeUndefined();
		expect(phone.vault.trashed).toEqual(["note.md"]);
		expect(phone.deviceStore.snapshot.has("note.md")).toBe(false);
	});

	it("leaves a file deleted on the Remote alone while it is being typed into, and trashes it once the pause is over", async () => {
		const { laptop, phone } = await syncedPair("original");
		await laptop.vault.trash("note.md");
		await syncNow(laptop);
		await phone.vault.typeInto("note.md", bytes("original"));

		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("original");

		phone.clock.advance(phone.schedule.editPause.ms);
		await syncNow(phone);
		expect(await phone.vault.stat("note.md")).toBeNull();
	});

	it("does not take a path left out for a case clash for a deleted one", async () => {
		const remote = new FakeRemote({ nameRules: { caseInsensitive: true } });
		const { laptop, phone } = await syncedPair("original", remote);
		await phone.vault.write("NOTE.md", bytes("another note"));

		await syncNow(phone);
		await syncNow(laptop);

		expect(remoteText(remote, "note.md")).toBe("original");
		expect(await vaultText(laptop, "note.md")).toBe("original");
		expect(await vaultText(phone, "note.md")).toBe("original");
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
	});
});

describe("an edit beats a delete", () => {
	it("brings back a file deleted here but edited on another device, with a notice", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await phone.vault.write("note.md", bytes("edited on phone"));
		await syncNow(phone);
		await laptop.vault.trash("note.md");

		await syncNow(laptop);

		expect(await vaultText(laptop, "note.md")).toBe("edited on phone");
		expect(remoteText(remote, "note.md")).toBe("edited on phone");
		expect(laptop.ui.notices).toEqual([{ kind: "restoredAfterDelete", path: "note.md", deletedOn: "thisDevice" }]);
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("edited on phone");
	});

	it("brings back a file another device wrote just before this device's delete, refused by its revision", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.trash("note.md");
		laptop.provider.beforeNext("delete", async () => {
			await phone.vault.write("note.md", bytes("edited on phone"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		expect(remoteText(remote, "note.md")).toBe("edited on phone");
		expect(await vaultText(laptop, "note.md")).toBe("edited on phone");
		expect(laptop.ui.notices).toEqual([{ kind: "restoredAfterDelete", path: "note.md", deletedOn: "thisDevice" }]);
		expect(laptop.deviceStore.snapshot.get("note.md")).toMatchObject({ kind: "file" });
	});

	it("keeps a file edited here but deleted on another device, uploads it again, with a notice", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.trash("note.md");
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("edited on phone"));

		await syncNow(phone);

		expect(await vaultText(phone, "note.md")).toBe("edited on phone");
		expect(remoteText(remote, "note.md")).toBe("edited on phone");
		expect(phone.vault.trashed).toEqual([]);
		expect(phone.ui.notices).toEqual([{ kind: "restoredAfterDelete", path: "note.md", deletedOn: "otherDevice" }]);
		await syncNow(laptop);
		expect(await vaultText(laptop, "note.md")).toBe("edited on phone");
	});
});

/**
 * A Remote with a laptop and a phone that both hold `projects/a.md`,
 * `projects/b.md` and `projects/old/c.md`, synced, plus four files outside
 * `projects`, so deleting the folder stays under the Deletion guard's
 * thresholds.
 */
async function syncedFolder(remote = new FakeRemote()): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	await laptop.vault.createFolder("projects");
	await laptop.vault.createFolder("projects/old");
	for (const path of ["projects/a.md", "projects/b.md", "projects/old/c.md", "k1.md", "k2.md", "k3.md", "k4.md"]) {
		await laptop.vault.write(path, bytes(path));
	}
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}

describe("deleting a folder on one device", () => {
	it("deletes its files and then the folders on the Remote, and moves them to the other device's trash", async () => {
		const { remote, laptop, phone } = await syncedFolder();
		await laptop.vault.trash("projects");

		await syncNow(laptop);
		expect(remote.get("projects")).toBeUndefined();
		expect(remote.get("projects/old")).toBeUndefined();
		await syncNow(phone);

		expect(await phone.vault.stat("projects")).toBeNull();
		expect([...phone.vault.trashed].sort()).toEqual(
			["projects", "projects/a.md", "projects/b.md", "projects/old", "projects/old/c.md"].sort(),
		);
		for (const device of [laptop, phone]) {
			expect([...device.deviceStore.snapshot.keys()].filter((path) => path.startsWith("projects"))).toEqual([]);
		}
		expect(await vaultText(phone, "k1.md")).toBe("k1.md");
	});

	it("keeps a folder another device added a file to before this sync, and brings it back with that file", async () => {
		const { remote, laptop, phone } = await syncedFolder();
		await phone.vault.write("projects/new.md", bytes("new"));
		await syncNow(phone);
		await laptop.vault.trash("projects");

		await syncNow(laptop);

		expect(remoteText(remote, "projects/new.md")).toBe("new");
		expect(remote.get("projects/a.md")).toBeUndefined();
		expect(remote.get("projects/old")).toBeUndefined();
		expect(await vaultText(laptop, "projects/new.md")).toBe("new");
	});

	it("keeps a folder another device adds a file to while this device deletes the files inside", async () => {
		const { remote, laptop, phone } = await syncedFolder();
		await laptop.vault.trash("projects");
		laptop.provider.beforeNext("delete", async () => {
			await phone.vault.write("projects/new.md", bytes("new"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		expect(remoteText(remote, "projects/new.md")).toBe("new");
		expect(remote.get("projects/b.md")).toBeUndefined();
		await syncNow(laptop);
		expect(await vaultText(laptop, "projects/new.md")).toBe("new");
	});

	it("checks the folder is empty through the change feed where the provider has one", async () => {
		const { remote, laptop, phone } = await syncedFolder(new FakeRemote({ changeFeed: true }));
		await syncNow(laptop);
		await laptop.vault.trash("projects");
		laptop.provider.beforeNext("delete", async () => {
			await phone.vault.write("projects/new.md", bytes("new"));
			await syncNow(phone);
		});

		await syncNow(laptop);

		expect(remoteText(remote, "projects/new.md")).toBe("new");
		expect(remote.get("projects/old")).toBeUndefined();
		await syncNow(laptop);
		expect(await vaultText(laptop, "projects/new.md")).toBe("new");
	});

	it("keeps a folder deleted on the Remote that holds a new file here, and uploads the file", async () => {
		const { remote, laptop, phone } = await syncedFolder();
		await laptop.vault.trash("projects");
		await syncNow(laptop);
		await phone.vault.write("projects/new.md", bytes("new"));

		await syncNow(phone);

		expect(await vaultText(phone, "projects/new.md")).toBe("new");
		expect(await phone.vault.stat("projects/a.md")).toBeNull();
		expect(phone.vault.trashed).not.toContain("projects");
		expect(remoteText(remote, "projects/new.md")).toBe("new");
	});
});

/** A Remote with a laptop and a phone that both hold `count` files, `f01.md` and on, synced. */
async function syncedFiles(count: number): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice; paths: string[] }> {
	const remote = new FakeRemote();
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	const paths = Array.from({ length: count }, (_, index) => `f${String(index + 1).padStart(2, "0")}.md`);
	for (const path of paths) await laptop.vault.write(path, bytes(path));
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone, paths };
}

/** The files of the Remote mirror, by path. */
function remoteFiles(remote: FakeRemote): string[] {
	return mirror(remote)
		.filter((entry) => entry.kind === "file")
		.map((entry) => entry.path)
		.sort();
}

describe("the Deletion guard", () => {
	it("applies deletions within N and P without asking", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 5)) await laptop.vault.trash(path);

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([]);
		expect(remoteFiles(remote)).toEqual(paths.slice(5));
	});

	it("asks before deleting more than P % of the files on the Remote, and Apply deletes them", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 6)) await laptop.vault.trash(path);
		laptop.ui.answers.push("apply");

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([{ reason: "threshold", toRemote: paths.slice(0, 6), toVault: [] }]);
		expect(remoteFiles(remote)).toEqual(paths.slice(6));
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});

	it("brings the files deleted here back from the Remote on Restore", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 6)) await laptop.vault.trash(path);
		laptop.ui.answers.push("restore");

		await syncNow(laptop);

		expect(remoteFiles(remote)).toEqual(paths);
		for (const path of paths) expect(await vaultText(laptop, path)).toBe(path);
		expect(laptop.deviceStore.snapshot.size).toBe(10);
		expect(laptop.ui.notices).toEqual([]);
	});

	it("asks before trashing more than N files deleted on the Remote, and Restore uploads them back", async () => {
		const { remote, laptop, phone, paths } = await syncedFiles(10);
		phone.deletionGuard = { maxFiles: 3, maxPercent: 50 };
		for (const path of paths.slice(0, 4)) await laptop.vault.trash(path);
		await syncNow(laptop);
		phone.ui.answers.push("restore");

		await syncNow(phone);

		expect(phone.ui.prompts).toEqual([{ reason: "threshold", toRemote: [], toVault: paths.slice(0, 4) }]);
		expect(phone.vault.trashed).toEqual([]);
		expect(remoteFiles(remote)).toEqual(paths);
		await syncNow(laptop);
		for (const path of paths) expect(await vaultText(laptop, path)).toBe(path);
	});

	it("does not count folders against N and P", async () => {
		const { remote, laptop, phone } = await syncedFiles(2);
		for (let index = 1; index <= 5; index += 1) await laptop.vault.createFolder(`empty${index}`);
		await syncNow(laptop);
		await syncNow(phone);
		laptop.deletionGuard = { maxFiles: 1, maxPercent: 1 };
		for (let index = 1; index <= 5; index += 1) await laptop.vault.trash(`empty${index}`);

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([]);
		expect(mirror(remote).filter((entry) => entry.kind === "folder")).toEqual([]);
	});

	it("always asks when the vault has lost every file, whatever N and P allow, and writes nothing until answered", async () => {
		const { remote, laptop, paths } = await syncedFiles(3);
		laptop.deletionGuard = { maxFiles: 100_000, maxPercent: 100 };
		for (const path of paths) await laptop.vault.trash(path);
		laptop.ui.answers.push(null);

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([{ reason: "missingVault", toRemote: paths, toVault: [] }]);
		expect(remoteFiles(remote)).toEqual(paths);
		expect(laptop.deviceStore.snapshot.size).toBe(3);
		expect(laptop.ui.lastStatus).toEqual({ state: "deletionsOnHold" });
	});

	it("always asks when the Remote has lost every file, and Restore uploads them back", async () => {
		const { remote, phone, paths } = await syncedFiles(3);
		phone.deletionGuard = { maxFiles: 100_000, maxPercent: 100 };
		for (const path of paths) remote.remove(path);
		phone.ui.answers.push("restore");

		await syncNow(phone);

		expect(phone.ui.prompts).toEqual([{ reason: "emptyRemote", toRemote: [], toVault: paths }]);
		expect(remoteFiles(remote)).toEqual(paths);
		expect(phone.vault.trashed).toEqual([]);
	});

	it("holds sync after the prompt is closed: automatic syncs do not ask again, Sync now does", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 6)) await laptop.vault.trash(path);
		await laptop.vault.write("new.md", bytes("new"));
		const engine = createSyncEngine(laptop.ports);
		laptop.ui.answers.push(null);
		await engine.sync();

		await engine.sync("automatic");
		expect(laptop.ui.prompts).toHaveLength(1);
		expect(laptop.ui.lastStatus).toEqual({ state: "deletionsOnHold" });
		expect(remote.get("new.md")).toBeUndefined();

		laptop.ui.answers.push("apply");
		await engine.sync();
		expect(laptop.ui.prompts).toHaveLength(2);
		expect(remoteFiles(remote)).toEqual([...paths.slice(6), "new.md"].sort());
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});
});

describe("deletions found by the review", () => {
	it("counts a file deleted here whose new Remote revision has the synced content, and Restore brings it back", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 6)) {
			await laptop.vault.trash(path);
			remote.put(path, { kind: "file", data: bytes(path), revision: remote.nextRevision() });
		}
		laptop.ui.answers.push("restore");

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([{ reason: "threshold", toRemote: paths.slice(0, 6), toVault: [] }]);
		expect(remoteFiles(remote)).toEqual(paths);
		for (const path of paths) expect(await vaultText(laptop, path)).toBe(path);
	});

	it("deletes a file deleted here whose new Remote revision has the synced content, without a notice", async () => {
		const { remote, laptop } = await syncedPair("original");
		await laptop.vault.trash("note.md");
		remote.put("note.md", { kind: "file", data: bytes("original"), revision: remote.nextRevision() });

		await syncNow(laptop);

		expect(remote.get("note.md")).toBeUndefined();
		expect(await laptop.vault.stat("note.md")).toBeNull();
		expect(laptop.ui.notices).toEqual([]);
	});

	it("deletes a file whose Remote name differs in case on a case-insensitive provider, instead of downloading it again", async () => {
		const remote = new FakeRemote({ nameRules: { caseInsensitive: true } });
		remote.put("Note.md", { kind: "file", data: bytes("same"), revision: remote.nextRevision() });
		const laptop = connectTestDevice(remote, "Laptop");
		for (const path of ["note.md", "k1.md", "k2.md"]) await laptop.vault.write(path, bytes(path === "note.md" ? "same" : path));
		await syncNow(laptop);
		await laptop.vault.trash("note.md");

		await syncNow(laptop);

		expect(remote.get("Note.md")).toBeUndefined();
		expect(await laptop.vault.stat("note.md")).toBeNull();
		expect(await laptop.vault.stat("Note.md")).toBeNull();
		expect(laptop.deviceStore.snapshot.has("note.md")).toBe(false);
	});

	it("always asks when the vault has none of its synced files left, though it holds a new one", async () => {
		const { remote, laptop, paths } = await syncedFiles(3);
		laptop.deletionGuard = { maxFiles: 100_000, maxPercent: 100 };
		for (const path of paths) await laptop.vault.trash(path);
		await laptop.vault.write("new.md", bytes("new"));
		laptop.ui.answers.push(null);

		await syncNow(laptop);

		expect(laptop.ui.prompts).toEqual([{ reason: "missingVault", toRemote: paths, toVault: [] }]);
		expect(remoteFiles(remote)).toEqual(paths);
	});

	it("always asks when the Remote has none of the synced files left, though it holds a new one", async () => {
		const { remote, phone, paths } = await syncedFiles(3);
		phone.deletionGuard = { maxFiles: 100_000, maxPercent: 100 };
		for (const path of paths) remote.remove(path);
		remote.put("new.md", { kind: "file", data: bytes("new"), revision: remote.nextRevision() });
		phone.ui.answers.push(null);

		await syncNow(phone);

		expect(phone.ui.prompts).toEqual([{ reason: "emptyRemote", toRemote: [], toVault: paths }]);
		expect(phone.vault.trashed).toEqual([]);
	});

	it("asks again for a sync the user asked for while the prompt was open, though the prompt was closed", async () => {
		const { remote, laptop, paths } = await syncedFiles(10);
		for (const path of paths.slice(0, 6)) await laptop.vault.trash(path);
		const engine = createSyncEngine(laptop.ports);
		laptop.ui.onAsk = () => {
			laptop.ui.onAsk = undefined;
			void engine.sync();
		};
		laptop.ui.answers.push(null, "apply");

		await engine.sync("automatic");

		expect(laptop.ui.prompts).toHaveLength(2);
		expect(remoteFiles(remote)).toEqual(paths.slice(6));
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
	});
});
