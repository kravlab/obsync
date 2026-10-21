import { describe, expect, it } from "vitest";
import {
	DEFAULT_REMOTE_SETTINGS,
	METADATA_FOLDER,
	SETTINGS_PATH,
	encodeSettings,
	type RemoteSettings,
} from "../../src/engine/remote-metadata";
import { ProviderError } from "../../src/engine/provider";
import { FakeRemote, type FakeServiceOptions } from "../fakes/fake-remote";
import { connectTestDevice } from "../fakes/test-device";
import { bytes } from "../support/bytes";
import { mirror, putRemoteFile, remoteText, syncNow, vaultText, writeVaultFile } from "../support/sync";

/** A Remote on a service with `service`, whose shared settings are the defaults with `settings` on top. */
function remoteWith(settings: Partial<RemoteSettings>, service: FakeServiceOptions = {}): FakeRemote {
	const remote = new FakeRemote(service);
	remote.put(METADATA_FOLDER, { kind: "folder" });
	writeSettings(remote, settings);
	return remote;
}

/** Replaces the Remote's shared settings with the defaults and `settings` on top, as another device changing them would. */
function writeSettings(remote: FakeRemote, settings: Partial<RemoteSettings>): void {
	remote.put(SETTINGS_PATH, {
		kind: "file",
		data: encodeSettings({ ...DEFAULT_REMOTE_SETTINGS, ...settings }),
		revision: remote.nextRevision(),
	});
}

/** The paths of the Remote's mirror files. */
function remoteFiles(remote: FakeRemote): string[] {
	return mirror(remote)
		.filter((entry) => entry.kind === "file")
		.map((entry) => entry.path)
		.sort();
}

describe("hidden paths", () => {
	it("never downloads a dot-path from the Remote, at the top or inside a folder", async () => {
		const remote = remoteWith({});
		putRemoteFile(remote, ".git/config", "[core]");
		putRemoteFile(remote, "notes/.DS_Store", "finder");
		putRemoteFile(remote, "notes/day.md", "day");
		const laptop = connectTestDevice(remote, "Laptop");
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(await vaultText(laptop, "notes/day.md")).toBe("day");
		expect(await laptop.vault.stat(".git/config")).toBeNull();
		expect(await laptop.vault.stat("notes/.DS_Store")).toBeNull();
		expect(remote.get(".git/config")?.kind).toBe("file");
	});
});

describe("the ignore list", () => {
	it("neither uploads nor downloads a path it matches, on any device", async () => {
		const remote = remoteWith({ ignoreList: ["Archive/", "*.tmp"] });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "Archive/old.md", "old");
		await writeVaultFile(laptop, "scratch.tmp", "tmp");
		await writeVaultFile(laptop, "note.md", "note");
		putRemoteFile(remote, "projects/Archive/plan.md", "plan");
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual(["note.md", "projects/Archive/plan.md"]);
		expect(await laptop.vault.stat("projects/Archive/plan.md")).toBeNull();
		const phone = connectTestDevice(remote, "Phone");
		await syncNow(phone);
		expect(await vaultText(phone, "note.md")).toBe("note");
		expect(await phone.vault.stat("projects/Archive/plan.md")).toBeNull();
	});

	it("never takes a synced path it now matches for deleted", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "drafts/idea.md", "idea");
		await writeVaultFile(laptop, "note.md", "note");
		await syncNow(laptop);
		await syncNow(phone);
		writeSettings(remote, { ignoreList: ["drafts/"] });
		await laptop.vault.trash("drafts/idea.md");
		await syncNow(laptop);
		await syncNow(phone);
		expect(remoteFiles(remote)).toEqual(["drafts/idea.md", "note.md"]);
		expect(await vaultText(phone, "drafts/idea.md")).toBe("idea");
	});

	it("deletes a file's old path on the other devices when it is moved into an ignored folder", async () => {
		const remote = remoteWith({ ignoreList: ["Archive/"] });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "done.md", "done");
		await writeVaultFile(laptop, "a.md", "a");
		await writeVaultFile(laptop, "b.md", "b");
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.createFolder("Archive");
		await laptop.vault.rename("done.md", "Archive/done.md");
		await syncNow(laptop);
		await syncNow(phone);
		expect(remoteFiles(remote)).toEqual(["a.md", "b.md"]);
		expect(await phone.vault.stat("done.md")).toBeNull();
		expect(await vaultText(laptop, "Archive/done.md")).toBe("done");
	});
});

describe("the size ceiling", () => {
	it("neither uploads nor downloads a file above it, and syncs the rest", async () => {
		const remote = remoteWith({ sizeCeilingBytes: 10 });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "big.pdf", "eleven byte");
		await writeVaultFile(laptop, "small.md", "ten bytes!");
		putRemoteFile(remote, "huge.mp4", "more than ten");
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteFiles(remote)).toEqual(["huge.mp4", "small.md"]);
		expect(await laptop.vault.stat("huge.mp4")).toBeNull();
	});

	it("leaves a synced file that grew above it as it is on the Remote and the other devices", async () => {
		const remote = remoteWith({ sizeCeilingBytes: 10 });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "note.md", "short");
		await syncNow(laptop);
		await syncNow(phone);
		await laptop.vault.write("note.md", bytes("now far too long"));
		await syncNow(laptop);
		await syncNow(phone);
		expect(remoteFiles(remote)).toEqual(["note.md"]);
		expect(await vaultText(phone, "note.md")).toBe("short");
		expect(await vaultText(laptop, "note.md")).toBe("now far too long");
	});
});

describe("names the provider cannot store, skipped and reported", () => {
	it("leaves out a vault path with a forbidden character and syncs the rest", async () => {
		const remote = remoteWith({}, { nameRules: { forbiddenCharacters: [":"], reservedNames: ["desktop.ini"] } });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "a:b/note.md", "inside");
		await writeVaultFile(laptop, "time 10:30.md", "time");
		await writeVaultFile(laptop, "desktop.ini", "ini");
		await writeVaultFile(laptop, "ok.md", "ok");
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteFiles(remote)).toEqual(["ok.md"]);
	});
});

describe("names encoded reversibly", () => {
	it("stores a forbidden character under its substitute and brings the vault name back on another device", async () => {
		const remote = remoteWith({ namePolicy: "encodeReversibly" }, { nameRules: { forbiddenCharacters: [":"] } });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "10:30/meeting.md", "agenda");
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual(["10：30/meeting.md"]);
		await syncNow(phone);
		expect(await vaultText(phone, "10:30/meeting.md")).toBe("agenda");
		await phone.vault.write("10:30/meeting.md", bytes("agenda, edited"));
		await syncNow(phone);
		await syncNow(laptop);
		expect(await vaultText(laptop, "10:30/meeting.md")).toBe("agenda, edited");
		expect(remoteFiles(remote)).toEqual(["10：30/meeting.md"]);
	});

	it("carries a deletion of an encoded name to the other device", async () => {
		const remote = remoteWith({ namePolicy: "encodeReversibly" }, { nameRules: { forbiddenCharacters: [":"] } });
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		await writeVaultFile(laptop, "a:b.md", "gone soon");
		await writeVaultFile(laptop, "one.md", "1");
		await writeVaultFile(laptop, "two.md", "2");
		await syncNow(laptop);
		await syncNow(phone);
		expect(await vaultText(phone, "a:b.md")).toBe("gone soon");
		await laptop.vault.trash("a:b.md");
		await syncNow(laptop);
		await syncNow(phone);
		expect(remoteFiles(remote)).toEqual(["one.md", "two.md"]);
		expect(await phone.vault.stat("a:b.md")).toBeNull();
	});

	it("skips and reports a name already holding a substitute, which could not be decoded back", async () => {
		const remote = remoteWith({ namePolicy: "encodeReversibly" }, { nameRules: { forbiddenCharacters: [":"] } });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "wide：colon.md", "wide");
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual([]);
		expect(laptop.ui.lastSkipped).toEqual([{ path: "wide：colon.md", reason: "nameNotRepresentable" }]);
	});
});

describe("the skipped-files list", () => {
	it("lists every skipped file with its reason after each sync, but not hidden paths", async () => {
		const remote = remoteWith(
			{ ignoreList: ["*.tmp"], sizeCeilingBytes: 10 },
			{ nameRules: { forbiddenCharacters: [":"], caseInsensitive: true } },
		);
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "scratch.tmp", "tmp");
		await writeVaultFile(laptop, "a:b.md", "name");
		await writeVaultFile(laptop, "Note.md", "upper");
		await writeVaultFile(laptop, "note.md", "lower");
		await writeVaultFile(laptop, "big.pdf", "more than ten");
		await writeVaultFile(laptop, "ok.md", "ok");
		putRemoteFile(remote, ".trash/old.md", "old");
		putRemoteFile(remote, "huge.mp4", "also more than ten");
		await syncNow(laptop);
		expect(laptop.ui.lastSkipped).toEqual([
			{ path: "Note.md", reason: "caseClash" },
			{ path: "a:b.md", reason: "nameNotRepresentable" },
			{ path: "big.pdf", reason: "tooLarge" },
			{ path: "huge.mp4", reason: "tooLarge" },
			{ path: "note.md", reason: "caseClash" },
			{ path: "scratch.tmp", reason: "ignored" },
		]);
		await laptop.vault.trash("big.pdf");
		await syncNow(laptop);
		expect(laptop.ui.lastSkipped?.map(({ path }) => path)).not.toContain("big.pdf");
	});

	it("is shown also when a closed First sync preview holds sync", async () => {
		const remote = remoteWith({ ignoreList: ["*.tmp"] });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "scratch.tmp", "tmp");
		laptop.ui.firstSyncAnswers.push(null);
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "firstSyncWaiting" });
		expect(laptop.ui.lastSkipped).toEqual([{ path: "scratch.tmp", reason: "ignored" }]);
	});
});

describe("case clashes and the size ceiling", () => {
	it("syncs the one case variant under the ceiling and reports the larger one as too large", async () => {
		const remote = remoteWith({ sizeCeilingBytes: 10 }, { nameRules: { caseInsensitive: true } });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "Video.MP4", "far too long here");
		await writeVaultFile(laptop, "video.mp4", "small");
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual(["video.mp4"]);
		expect(laptop.ui.lastSkipped).toEqual([{ path: "Video.MP4", reason: "tooLarge" }]);
	});

	it("still leaves out both variants when both are under the ceiling", async () => {
		const remote = remoteWith({ sizeCeilingBytes: 10 }, { nameRules: { caseInsensitive: true } });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "Video.MP4", "big");
		await writeVaultFile(laptop, "video.mp4", "small");
		await writeVaultFile(laptop, "VIDEO.mp4", "far too long here");
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual([]);
		expect(laptop.ui.lastSkipped).toEqual([
			{ path: "VIDEO.mp4", reason: "tooLarge" },
			{ path: "Video.MP4", reason: "caseClash" },
			{ path: "video.mp4", reason: "caseClash" },
		]);
	});
});

describe("the size ceiling and the provider's maximum", () => {
	it("skips a file above the provider's maximum even under a larger ceiling", async () => {
		// Large enough for the device record, which a First sync writes.
		const remote = remoteWith({ sizeCeilingBytes: 1_000 }, { maxFileSize: 500 });
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "big.md", "x".repeat(501));
		await writeVaultFile(laptop, "s.md", "x".repeat(500));
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteFiles(remote)).toEqual(["s.md"]);
		expect(laptop.ui.lastSkipped).toEqual([{ path: "big.md", reason: "tooLarge" }]);
	});
});

describe("a refusal the provider's declared rules did not foresee", () => {
	it("skips and reports a file whose upload the provider refuses for its name, syncs the rest, and tries it again later", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		await syncNow(laptop);
		await writeVaultFile(laptop, "a.md", "a");
		await writeVaultFile(laptop, "bb.md", "bb");
		await writeVaultFile(laptop, "ccc.md", "ccc");
		laptop.provider.failNext("write", { category: "nameNotRepresentable" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteFiles(remote)).toEqual(["bb.md", "ccc.md"]);
		expect(laptop.ui.lastSkipped).toEqual([{ path: "a.md", reason: "nameNotRepresentable" }]);
		await syncNow(laptop);
		expect(remoteFiles(remote)).toEqual(["a.md", "bb.md", "ccc.md"]);
		expect(laptop.ui.lastSkipped).toEqual([]);
	});

	it("skips and reports an edited file whose upload the provider refuses for its size", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "note.md", "short");
		await syncNow(laptop);
		await laptop.vault.write("note.md", bytes("short, then longer"));
		laptop.provider.failNext("write", { category: "tooLarge" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(laptop.ui.lastSkipped).toEqual([{ path: "note.md", reason: "tooLarge" }]);
		expect(remoteText(remote, "note.md")).toBe("short");
	});

	it("skips the files of a folder whose creation the provider refuses", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		await syncNow(laptop);
		await writeVaultFile(laptop, "odd/inside.md", "inside");
		await writeVaultFile(laptop, "ok.md", "ok");
		laptop.provider.failNext("createFolder", { category: "nameNotRepresentable" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(remoteFiles(remote)).toEqual(["ok.md"]);
		expect(laptop.ui.lastSkipped).toEqual([{ path: "odd/inside.md", reason: "nameNotRepresentable" }]);
	});
});

describe("refusals while bringing an edit to the Remote", () => {
	it("skips and reports a file edited here but deleted on the Remote whose upload the provider refuses", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		const phone = connectTestDevice(remote, "Phone");
		for (const path of ["note.md", "one.md", "two.md"]) await writeVaultFile(laptop, path, path);
		await syncNow(laptop);
		await syncNow(phone);
		await phone.vault.trash("note.md");
		await syncNow(phone);
		await laptop.vault.write("note.md", bytes("edited here"));
		laptop.provider.failNext("write", { category: "tooLarge" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(laptop.ui.lastSkipped).toEqual([{ path: "note.md", reason: "tooLarge" }]);
		expect(await vaultText(laptop, "note.md")).toBe("edited here");
	});

	it("skips and reports a file edited here over a new Remote revision with the synced content", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "note.md", "synced");
		await syncNow(laptop);
		remote.put("note.md", { kind: "file", data: bytes("synced"), revision: remote.nextRevision() });
		await laptop.vault.write("note.md", bytes("edited here"));
		laptop.provider.failNext("write", { category: "nameNotRepresentable" });
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "synced" });
		expect(laptop.ui.lastSkipped).toEqual([{ path: "note.md", reason: "nameNotRepresentable" }]);
		expect(remoteText(remote, "note.md")).toBe("synced");
	});

	it("still stops the sync when a Conflict copy's upload is refused, instead of reporting the file", async () => {
		const remote = remoteWith({});
		const laptop = connectTestDevice(remote, "Laptop");
		await writeVaultFile(laptop, "photo.png", "original");
		await syncNow(laptop);
		await laptop.vault.write("photo.png", bytes("laptop's"));
		// Another device writes the photo just before this upload, which is refused; the Conflict copy's upload then is too.
		laptop.provider.beforeNext("write", () => {
			remote.put("photo.png", { kind: "file", data: bytes("other device's"), revision: remote.nextRevision() });
			return Promise.resolve();
		});
		laptop.provider.beforeNext("write", () =>
			Promise.reject(new ProviderError({ category: "nameNotRepresentable" }, "copy name refused")),
		);
		await syncNow(laptop);
		expect(laptop.ui.lastStatus).toEqual({ state: "syncFailed" });
		expect(laptop.ui.lastSkipped?.map(({ path }) => path) ?? []).not.toContain("photo.png");
	});
});
