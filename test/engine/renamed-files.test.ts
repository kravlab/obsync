import { describe, expect, it } from "vitest";
import { FakeRemote, type FakeServiceOptions } from "../fakes/fake-remote";
import { SimulatedCrash } from "../fakes/fake-provider";
import { connectTestDevice, type TestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { forgetNotices, mirror, remoteText, syncNow, vaultText, withStartedEngine } from "../support/sync";

/** 2026-10-20 14:30 on the test machine's own clock, the local time a Conflict copy is named after. */
const AFTERNOON = new Date(2026, 9, 20, 14, 30).getTime();

/**
 * A Remote on a service with `service`, and a laptop and a phone that both
 * hold `note.md` as `content`, synced, plus `keep.md`, which no test
 * touches; their clocks are at AFTERNOON.
 */
async function syncedPair(
	content: string,
	service: FakeServiceOptions = {},
): Promise<{ remote: FakeRemote; laptop: TestDevice; phone: TestDevice }> {
	const remote = new FakeRemote(service);
	const laptop = connectTestDevice(remote, "Laptop");
	const phone = connectTestDevice(remote, "Phone");
	laptop.clock.advance(AFTERNOON);
	phone.clock.advance(AFTERNOON);
	await laptop.vault.write("note.md", bytes(content));
	await laptop.vault.write("keep.md", bytes("kept"));
	await syncNow(laptop);
	await syncNow(phone);
	forgetNotices(laptop, phone);
	return { remote, laptop, phone };
}

/** The paths of the Remote mirror, sorted. */
function mirrorPaths(remote: FakeRemote): string[] {
	return mirror(remote)
		.map((entry) => entry.path)
		.sort();
}

/** The Remote revision of the file at `path`. */
function revisionOf(remote: FakeRemote, path: string): string {
	const stored = remote.get(path);
	if (stored?.kind !== "file") throw new Error(`no Remote file at ${path}`);
	return stored.revision;
}

describe("a file renamed on one device", () => {
	it("is renamed on the Remote and on the other device, with nothing trashed", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.rename("note.md", "renamed.md");

		await syncNow(laptop);
		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(remoteText(remote, "renamed.md")).toBe("original");
		await syncNow(phone);

		expect(await vaultText(phone, "renamed.md")).toBe("original");
		expect(await phone.vault.stat("note.md")).toBeNull();
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
		expect([...phone.deviceStore.snapshot.keys()].sort()).toEqual(["keep.md", "renamed.md"]);
		expect([...laptop.deviceStore.snapshot.keys()].sort()).toEqual(["keep.md", "renamed.md"]);
		expect([...laptop.ui.notices, ...phone.ui.notices]).toEqual([]);
	});

	it("is moved on the Remote without uploading it again when the service moves files", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { fileMove: true });
		const revision = revisionOf(remote, "note.md");
		await laptop.vault.rename("note.md", "folder-less name.md");

		await syncNow(laptop);
		await syncNow(phone);

		expect(revisionOf(remote, "folder-less name.md")).toBe(revision);
		expect(await vaultText(phone, "folder-less name.md")).toBe("original");
		expect(phone.vault.trashed).toEqual([]);
	});

	it("is moved into a new folder", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { fileMove: true });
		await laptop.vault.createFolder("archive");
		await laptop.vault.rename("note.md", "archive/note.md");

		await syncNow(laptop);
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["archive", "archive/note.md", "keep.md"]);
		expect(await vaultText(phone, "archive/note.md")).toBe("original");
		expect(phone.vault.trashed).toEqual([]);
	});
});

describe("a file renamed on one device and edited on the other", () => {
	it("ends up renamed with the edit, when the rename reaches the Remote first", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.rename("note.md", "renamed.md");
		await phone.vault.write("note.md", bytes("edited on phone"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(remoteText(remote, "renamed.md")).toBe("edited on phone");
		expect(await vaultText(phone, "renamed.md")).toBe("edited on phone");
		expect(await vaultText(laptop, "renamed.md")).toBe("edited on phone");
		expect(await phone.vault.stat("note.md")).toBeNull();
	});

	it("ends up renamed with the edit, when the edit reaches the Remote first", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.rename("note.md", "renamed.md");
		await phone.vault.write("note.md", bytes("edited on phone"));

		await syncNow(phone);
		await syncNow(laptop);
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(await vaultText(laptop, "renamed.md")).toBe("edited on phone");
		expect(await vaultText(phone, "renamed.md")).toBe("edited on phone");
		expect(await phone.vault.stat("note.md")).toBeNull();
	});

	it("merges edits made on both devices against the synced version, under the new name", async () => {
		const { remote, laptop, phone } = await syncedPair("line 1\nline 2\nline 3", { stableIds: true, fileMove: true });
		await laptop.vault.rename("note.md", "renamed.md");
		await syncNow(laptop);
		await laptop.vault.write("renamed.md", bytes("line 1\nline 2\nline 3 from laptop"));
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("line 1 from phone\nline 2\nline 3"));

		await syncNow(phone);
		await syncNow(laptop);

		const merged = "line 1 from phone\nline 2\nline 3 from laptop";
		expect(remoteText(remote, "renamed.md")).toBe(merged);
		expect(await vaultText(laptop, "renamed.md")).toBe(merged);
		expect(await vaultText(phone, "renamed.md")).toBe(merged);
		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
	});

	it("carries the rename on the Remote to a file edited here, by the Remote's stable id", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { stableIds: true, fileMove: true });
		await laptop.vault.rename("note.md", "renamed.md");
		await syncNow(laptop);
		await phone.vault.write("note.md", bytes("edited on phone"));

		await syncNow(phone);
		await syncNow(laptop);

		expect(await vaultText(phone, "renamed.md")).toBe("edited on phone");
		expect(await phone.vault.stat("note.md")).toBeNull();
		expect(remoteText(remote, "renamed.md")).toBe("edited on phone");
		expect(await vaultText(laptop, "renamed.md")).toBe("edited on phone");
	});
});

describe("a file renamed on one device and deleted on the other", () => {
	it("is kept under its new name when deleted on the other device first, with a notice", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await phone.vault.trash("note.md");
		await syncNow(phone);
		await laptop.vault.rename("note.md", "renamed.md");

		await syncNow(laptop);
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(await vaultText(phone, "renamed.md")).toBe("original");
		expect(laptop.ui.notices).toEqual([{ kind: "renameBeatsDelete", path: "renamed.md", deletedOn: "otherDevice" }]);
	});

	it("comes back under its new name on the device that deleted it, with a notice", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { stableIds: true });
		await laptop.vault.rename("note.md", "renamed.md");
		await syncNow(laptop);
		await phone.vault.trash("note.md");

		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(await vaultText(phone, "renamed.md")).toBe("original");
		expect(phone.ui.notices).toEqual([{ kind: "renameBeatsDelete", path: "renamed.md", deletedOn: "thisDevice" }]);
	});
});

describe("a file renamed on one device and deleted on the other, its new name taken there", () => {
	it("keeps the Remote's file under the name and the vault's as a Conflict copy", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { stableIds: true, fileMove: true });
		await laptop.vault.rename("note.md", "renamed.md");
		await syncNow(laptop);
		await phone.vault.trash("note.md");
		await phone.vault.write("renamed.md", bytes("written on phone"));

		await syncNow(phone);

		const copy = "renamed (conflict Phone 2026-10-20 1430).md";
		expect(await vaultText(phone, "renamed.md")).toBe("original");
		expect(await vaultText(phone, copy)).toBe("written on phone");
		expect(remoteText(remote, "renamed.md")).toBe("original");
		expect(remoteText(remote, copy)).toBe("written on phone");
		expect(phone.ui.notices).toEqual([{ kind: "conflictCopyCreated", path: "renamed.md", copyPath: copy }]);
	});
});

describe("a file renamed on both devices", () => {
	it("records the same rename once", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.rename("note.md", "renamed.md");
		await phone.vault.rename("note.md", "renamed.md");

		await syncNow(laptop);
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect([...phone.deviceStore.snapshot.keys()].sort()).toEqual(["keep.md", "renamed.md"]);
		expect(phone.ui.notices).toEqual([]);
	});

	it("takes the name the Remote has when the names differ, naming both in a notice", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await laptop.vault.rename("note.md", "laptop name.md");
		await phone.vault.rename("note.md", "phone name.md");

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "laptop name.md"]);
		expect(await vaultText(phone, "laptop name.md")).toBe("original");
		expect(await phone.vault.stat("phone name.md")).toBeNull();
		expect(phone.ui.notices).toEqual([{ kind: "renamedOnBoth", path: "laptop name.md", localPath: "phone name.md" }]);
		expect(laptop.ui.notices).toEqual([]);
	});
});

describe("a file renamed onto a path another device just used", () => {
	it("leaves the Remote's file the path and makes the renamed file a Conflict copy", async () => {
		const { remote, laptop, phone } = await syncedPair("mine");
		await phone.vault.write("taken.md", bytes("theirs"));
		await syncNow(phone);
		await laptop.vault.rename("note.md", "taken.md");

		await syncNow(laptop);
		await syncNow(phone);

		const copy = "taken (conflict Laptop 2026-10-20 1430).md";
		expect(laptop.ui.notices).toEqual([{ kind: "conflictCopyCreated", path: "taken.md", copyPath: copy }]);
		expect(mirrorPaths(remote)).toEqual(["keep.md", "taken.md", copy].sort());
		expect(remoteText(remote, "taken.md")).toBe("theirs");
		expect(remoteText(remote, copy)).toBe("mine");
		expect(await vaultText(laptop, "taken.md")).toBe("theirs");
		expect(await vaultText(phone, copy)).toBe("mine");
		expect(await phone.vault.stat("note.md")).toBeNull();
	});

	for (const service of [{}, { fileMove: true }] as const) {
		it(`makes the Conflict copy on the next sync when the path is taken after the listing, on a service with ${JSON.stringify(service)}`, async () => {
			const { remote, laptop, phone } = await syncedPair("mine", service);
			await laptop.vault.rename("note.md", "taken.md");
			laptop.provider.beforeNext(service.fileMove === true ? "moveFile" : "write", async () => {
				await phone.provider.write("taken.md", bytes("theirs"));
			});

			await syncNow(laptop);
			expect(remoteText(remote, "taken.md")).toBe("theirs");
			await syncNow(laptop);

			const copy = "taken (conflict Laptop 2026-10-20 1430).md";
			expect(remoteText(remote, "taken.md")).toBe("theirs");
			expect(remoteText(remote, copy)).toBe("mine");
			expect(await vaultText(laptop, "taken.md")).toBe("theirs");
			expect(await vaultText(laptop, copy)).toBe("mine");
			expect(mirrorPaths(remote)).toEqual(["keep.md", "taken.md", copy].sort());
			expect(laptop.ui.notices).toEqual([{ kind: "conflictCopyCreated", path: "taken.md", copyPath: copy }]);
		});
	}

	it("makes this device's new file a Conflict copy when the Remote renamed a file onto its path", async () => {
		const { remote, laptop, phone } = await syncedPair("renamed there", { stableIds: true });
		await laptop.vault.rename("note.md", "taken.md");
		await syncNow(laptop);
		await phone.vault.write("taken.md", bytes("new here"));

		await syncNow(phone);

		const copy = "taken (conflict Phone 2026-10-20 1430).md";
		expect(phone.ui.notices).toEqual([{ kind: "conflictCopyCreated", path: "taken.md", copyPath: copy }]);
		expect(await vaultText(phone, "taken.md")).toBe("renamed there");
		expect(await vaultText(phone, copy)).toBe("new here");
		expect(remoteText(remote, copy)).toBe("new here");
		expect(await phone.vault.stat("note.md")).toBeNull();
	});
});

/** Writes `docs/a.md` and `docs/b.png` on `device`. */
async function writeDocs(device: TestDevice): Promise<void> {
	await device.vault.createFolder("docs");
	await device.vault.write("docs/a.md", bytes("a"));
	await device.vault.write("docs/b.png", bytes("b"));
}

describe("a folder renamed on one device", () => {
	it("is moved in one step on a service that moves folders, keeping what another device added inside", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { folderMove: true });
		await writeDocs(laptop);
		await syncNow(laptop);
		await syncNow(phone);
		const revisions = [revisionOf(remote, "docs/a.md"), revisionOf(remote, "docs/b.png")];
		await laptop.vault.rename("docs", "notes");
		await phone.vault.write("docs/added.md", bytes("added on phone"));

		await syncNow(laptop);
		await syncNow(phone);
		await syncNow(laptop);

		expect([revisionOf(remote, "notes/a.md"), revisionOf(remote, "notes/b.png")]).toEqual(revisions);
		expect(mirrorPaths(remote)).toEqual(["keep.md", "note.md", "notes", "notes/a.md", "notes/added.md", "notes/b.png"]);
		expect(await vaultText(phone, "notes/added.md")).toBe("added on phone");
		expect(await vaultText(laptop, "notes/added.md")).toBe("added on phone");
		expect(await phone.vault.stat("docs")).toBeNull();
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
	});

	it("is moved file by file on a service that does not, and the old folder goes once empty", async () => {
		const { remote, laptop, phone } = await syncedPair("original");
		await writeDocs(laptop);
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.rename("docs", "notes");

		await syncNow(laptop);
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "note.md", "notes", "notes/a.md", "notes/b.png"]);
		expect(await vaultText(phone, "notes/a.md")).toBe("a");
		expect(await phone.vault.stat("docs")).toBeNull();
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
		expect([...phone.deviceStore.snapshot.keys()].sort()).toEqual([
			"keep.md",
			"note.md",
			"notes",
			"notes/a.md",
			"notes/b.png",
		]);
	});

	it("keeps a file another device added to the old folder on a service that cannot move folders", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { fileMove: true });
		await writeDocs(laptop);
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.rename("docs", "notes");
		await phone.vault.write("docs/added.md", bytes("added on phone"));
		await syncNow(phone);

		await syncNow(laptop);
		await syncNow(phone);

		expect(remoteText(remote, "docs/added.md")).toBe("added on phone");
		expect(await vaultText(laptop, "docs/added.md")).toBe("added on phone");
		expect(await vaultText(phone, "notes/a.md")).toBe("a");
		expect(mirrorPaths(remote)).toEqual(["docs", "docs/added.md", "keep.md", "note.md", "notes", "notes/a.md", "notes/b.png"]);
	});

	it("does not stop at the Deletion guard however many files it holds", async () => {
		const { laptop, phone } = await syncedPair("original", { fileMove: true });
		await laptop.vault.createFolder("big");
		for (let index = 0; index < 120; index += 1) await laptop.vault.write(`big/${index}.md`, bytes(`note ${index}`));
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.rename("big", "moved");

		await syncNow(laptop);
		await syncNow(phone);

		expect([...laptop.ui.prompts, ...phone.ui.prompts]).toEqual([]);
		expect(await vaultText(phone, "moved/119.md")).toBe("note 119");
		expect(phone.vault.trashed).toEqual([]);
	});
});

describe("a file whose name changed only in case, on a case-insensitive service", () => {
	it("is recorded under its new case here, while the Remote keeps its own", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { nameRules: { caseInsensitive: true } });
		await laptop.vault.rename("note.md", "Note.md");

		await syncNow(laptop);
		await syncNow(laptop);
		await syncNow(phone);

		expect([...laptop.deviceStore.snapshot.keys()].sort()).toEqual(["Note.md", "keep.md"]);
		expect(mirrorPaths(remote)).toEqual(["keep.md", "note.md"]);
		expect(await vaultText(laptop, "Note.md")).toBe("original");
		expect(await vaultText(phone, "note.md")).toBe("original");
	});
});

/** Two synced devices on one Remote, as `syncedPair` gives them. */
type Pair = Awaited<ReturnType<typeof syncedPair>>;

/** What a crash test does around the sync it cuts off. */
interface CrashScenario {
	/** Brings the devices to the moment before the sync that crashes. */
	prepare(pair: Pair): Promise<void>;
	/** The device whose sync crashes. */
	crashing(pair: Pair): TestDevice;
	/** The syncs after the crash, on fresh engines over the same stores. */
	recover(pair: Pair): Promise<void>;
	/** What must hold once recovered; \`at\` names the crash for messages. */
	check(pair: Pair, at: string): Promise<void>;
}

/**
 * Runs \`scenario\` on a service with \`service\` once for every step of the
 * crashing sync, crashing before it and after it, until a sync gets past
 * its last step.
 */
async function crashAtEveryStep(service: FakeServiceOptions, scenario: CrashScenario): Promise<void> {
	for (const when of ["before", "after"] as const) {
		let reachedCompletion = false;
		for (let step = 1; step <= 100 && !reachedCompletion; step += 1) {
			const pair = await syncedPair("original", service);
			await scenario.prepare(pair);
			const device = scenario.crashing(pair);
			if (when === "before") device.crash.crashBefore(step);
			else device.crash.crashAfter(step);
			const outcome = await syncNow(device).then(
				() => "completed" as const,
				(error: unknown) => error,
			);
			if (outcome === "completed") {
				reachedCompletion = true;
				continue;
			}
			expect(outcome).toBeInstanceOf(SimulatedCrash);
			await scenario.recover(pair);
			await scenario.check(pair, `crash ${when} step ${step}`);
		}
		expect(reachedCompletion, `a sync crashing ${when} step 100 never completed`).toBe(true);
	}
}

/** The sorted paths of every entry of `device`'s vault. */
async function vaultPaths(device: TestDevice): Promise<string[]> {
	return (await device.vault.list()).map(({ path }) => path).sort();
}

/** The texts of every file of the Remote mirror. */
function mirrorTexts(remote: FakeRemote): string[] {
	return mirror(remote)
		.filter((entry) => entry.kind === "file")
		.map((entry) => remoteText(remote, entry.path));
}

/** Renames `note.md` and the folder `docs` on the laptop, which holds both synced. */
async function renameNoteAndDocs({ laptop }: Pair): Promise<void> {
	await laptop.vault.rename("note.md", "renamed.md");
	await laptop.vault.rename("docs", "notes");
}

describe("a rename cut off at any step", () => {
	for (const service of [{}, { fileMove: true, folderMove: true, stableIds: true }] as const) {
		it(`is completed by the next sync, on a service with ${JSON.stringify(service)}`, async () => {
			await crashAtEveryStep(service, {
				async prepare(pair) {
					await writeDocs(pair.laptop);
					await syncNow(pair.laptop);
					await syncNow(pair.phone);
					await pair.phone.vault.write("docs/a.md", bytes("a edited on phone"));
					await syncNow(pair.phone);
					await renameNoteAndDocs(pair);
				},
				crashing: ({ laptop }) => laptop,
				async recover({ laptop, phone }) {
					await syncNow(laptop);
					await syncNow(phone);
				},
				async check({ remote, laptop, phone }, at) {
					const paths = mirrorPaths(remote);
					// A cut-off that leaves the moved file on the Remote while the old one is gone looks like
					// a rename onto an occupied path: at most a Conflict copy more, nothing lost.
					expect(paths.filter((path) => !path.includes("(conflict Laptop ")), at).toEqual(
						["keep.md", "notes", "notes/a.md", "notes/b.png", "renamed.md"],
					);
					expect(await vaultPaths(phone), at).toEqual(paths);
					expect(await vaultPaths(laptop), at).toEqual(paths);
					expect(remoteText(remote, "notes/a.md"), at).toBe("a edited on phone");
					expect(await vaultText(laptop, "notes/a.md"), at).toBe("a edited on phone");
					expect(await vaultText(phone, "renamed.md"), at).toBe("original");
					const notices = [...laptop.ui.notices, ...phone.ui.notices];
					expect(notices.filter((notice) => notice.kind !== "conflictCopyCreated"), at).toEqual([]);
				},
			});
		});

		it(`is completed by the receiving device's next sync, its own edit kept, on a service with ${JSON.stringify(service)}`, async () => {
			await crashAtEveryStep(service, {
				async prepare(pair) {
					await writeDocs(pair.laptop);
					await syncNow(pair.laptop);
					await syncNow(pair.phone);
					await renameNoteAndDocs(pair);
					await syncNow(pair.laptop);
					await pair.phone.vault.write("note.md", bytes("edited on phone"));
				},
				crashing: ({ phone }) => phone,
				async recover({ laptop, phone }) {
					await syncNow(phone);
					await syncNow(laptop);
				},
				async check({ remote, laptop, phone }, at) {
					const paths = mirrorPaths(remote);
					expect(paths, at).toEqual(expect.arrayContaining(["keep.md", "notes", "notes/a.md", "notes/b.png", "renamed.md"]));
					expect(paths.filter((path) => path.startsWith("docs") || path === "note.md"), at).toEqual([]);
					expect(await vaultPaths(phone), at).toEqual(paths);
					expect(await vaultPaths(laptop), at).toEqual(paths);
					// The phone's edit survives: under the new name, or in a Conflict copy when the crash left that ambiguous.
					expect(mirrorTexts(remote).some((content) => content.includes("edited on phone")), at).toBe(true);
				},
			});
		});
	}
});


describe("a file renamed and edited while Obsidian runs", () => {
	it("is carried as a rename with the edit, from the vault's rename event", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { fileMove: true, stableIds: true });
		const revision = revisionOf(remote, "note.md");

		await withStartedEngine(laptop, async (engine) => {
			await laptop.vault.rename("note.md", "renamed.md");
			await laptop.vault.write("renamed.md", bytes("edited after the rename"));
			await engine.sync();
		});
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["keep.md", "renamed.md"]);
		expect(revisionOf(remote, "renamed.md")).not.toBe(revision);
		expect(await vaultText(phone, "renamed.md")).toBe("edited after the rename");
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
		expect(laptop.ui.notices).toEqual([]);
	});

	it("keeps the user's rename made while a sync writes to the vault", async () => {
		const { remote, laptop, phone } = await syncedPair("original", { fileMove: true, stableIds: true });
		await phone.vault.write("incoming.md", bytes("from phone"));
		await syncNow(phone);

		laptop.vault.beforeNextWrite("incoming.md", async () => {
			await laptop.vault.rename("note.md", "renamed.md");
			await laptop.vault.write("renamed.md", bytes("edited after the rename"));
		});

		// The vault-open sync downloads incoming.md, during which the user renames and edits the note.
		await withStartedEngine(laptop, async (engine) => engine.sync());
		await syncNow(phone);

		expect(mirrorPaths(remote)).toEqual(["incoming.md", "keep.md", "renamed.md"]);
		expect(await vaultText(phone, "renamed.md")).toBe("edited after the rename");
		expect([...laptop.vault.trashed, ...phone.vault.trashed]).toEqual([]);
	});

	it("is not taken for a rename again once a sync carried it", async () => {
		const { remote, laptop } = await syncedPair("original", { fileMove: true });

		await withStartedEngine(laptop, async (engine) => {
			await laptop.vault.rename("note.md", "renamed.md");
			await engine.sync();
			await laptop.vault.write("note.md", bytes("a new note at the old name"));
			await engine.sync();
		});

		expect(mirrorPaths(remote)).toEqual(["keep.md", "note.md", "renamed.md"]);
		expect(remoteText(remote, "note.md")).toBe("a new note at the old name");
		expect(remoteText(remote, "renamed.md")).toBe("original");
	});
});
