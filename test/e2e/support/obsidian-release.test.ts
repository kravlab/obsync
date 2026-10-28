import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apkName, appImageName, ensureApk, releaseDigest, sha256Of } from "./obsidian-release";

describe("the AppImage of an Obsidian release", () => {
	it("is named after the version, with the arm64 build marked", () => {
		expect(appImageName("1.14.4", "x64")).toBe("Obsidian-1.14.4.AppImage");
		expect(appImageName("1.14.4", "arm64")).toBe("Obsidian-1.14.4-arm64.AppImage");
	});

	it("is refused on an architecture Obsidian builds no AppImage for", () => {
		expect(() => appImageName("1.14.4", "ia32")).toThrow(/no Obsidian AppImage for ia32/);
	});
});

describe("the APK of an Obsidian release", () => {
	it("is named after the version", () => {
		expect(apkName("1.14.4")).toBe("Obsidian-1.14.4.apk");
	});
});

describe("the sha256 a release states for an asset", () => {
	const release = {
		assets: [
			{ name: "Obsidian-1.14.4-arm64.AppImage", digest: "sha256:aa" },
			{ name: "Obsidian-1.14.4.AppImage", digest: "sha256:6362ddbe" },
		],
	};

	it("is read from the asset of that name", () => {
		expect(releaseDigest(release, "Obsidian-1.14.4.AppImage")).toBe("6362ddbe");
	});

	it("is refused when the release has no such asset", () => {
		expect(() => releaseDigest(release, "Obsidian-9.9.9.AppImage")).toThrow(/no asset Obsidian-9\.9\.9\.AppImage/);
	});

	it("is refused when the asset states no sha256", () => {
		const unsigned = { assets: [{ name: "Obsidian-1.14.4.AppImage", digest: null }] };
		expect(() => releaseDigest(unsigned, "Obsidian-1.14.4.AppImage")).toThrow(/states no sha256/);
	});

	it("is refused when the answer is not a release", () => {
		expect(() => releaseDigest({ message: "Not Found" }, "Obsidian-1.14.4.AppImage")).toThrow(/not a release/);
	});
});

describe("the sha256 of a file", () => {
	let dir: string | undefined;
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it("is the hex digest of its bytes", async () => {
		dir = await mkdtemp(join(tmpdir(), "obsync-sha-"));
		const file = join(dir, "abc");
		await writeFile(file, "abc");
		expect(await sha256Of(file)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});
});

describe("the APK a run installs", () => {
	const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
	const SHA_NEW = createHash("sha256").update("new").digest("hex");
	let dir: string | undefined;
	afterEach(async () => {
		vi.unstubAllGlobals();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	/** A fake GitHub: the release states `digest` for the APK, whose download is `bytes`; `asked` records each URL. */
	function github(digest: string, bytes: string): string[] {
		const asked: string[] = [];
		vi.stubGlobal("fetch", (url: string) => {
			asked.push(url);
			if (url.includes("/releases/tags/")) return Promise.resolve(Response.json({ assets: [{ name: apkName("1.2.3"), digest: `sha256:${digest}` }] }));
			return Promise.resolve(new Response(bytes));
		});
		return asked;
	}

	it("is downloaded the first time, with the sha256 the release states kept beside it", async () => {
		dir = await mkdtemp(join(tmpdir(), "obsync-apk-"));
		const asked = github(SHA_NEW, "new");
		const apk = await ensureApk(dir, "1.2.3");
		expect(apk).toBe(join(dir, apkName("1.2.3")));
		expect(await readFile(apk, "utf8")).toBe("new");
		expect(await readFile(`${apk}.sha256`, "utf8")).toBe(SHA_NEW);
		expect(asked).toHaveLength(2);
	});

	it("is the one already there, with no request, while its bytes still have the sha256 kept beside it", async () => {
		dir = await mkdtemp(join(tmpdir(), "obsync-apk-"));
		const apk = join(dir, apkName("1.2.3"));
		await writeFile(apk, "abc");
		await writeFile(`${apk}.sha256`, SHA_ABC);
		const asked = github(SHA_NEW, "new");
		expect(await ensureApk(dir, "1.2.3")).toBe(apk);
		expect(await readFile(apk, "utf8")).toBe("abc");
		expect(asked).toEqual([]);
	});

	it("is downloaded again when the one there no longer has the sha256 kept beside it, or none is kept", async () => {
		dir = await mkdtemp(join(tmpdir(), "obsync-apk-"));
		const apk = join(dir, apkName("1.2.3"));
		await writeFile(apk, "abc, damaged");
		await writeFile(`${apk}.sha256`, SHA_ABC);
		github(SHA_NEW, "new");
		await ensureApk(dir, "1.2.3");
		expect(await readFile(apk, "utf8")).toBe("new");

		await rm(`${apk}.sha256`);
		const asked = github(SHA_NEW, "new");
		await ensureApk(dir, "1.2.3");
		expect(asked).toHaveLength(2);
		expect(await readFile(`${apk}.sha256`, "utf8")).toBe(SHA_NEW);
	});

	it("is refused when the download's sha256 is not the one the release states, and nothing is kept", async () => {
		dir = await mkdtemp(join(tmpdir(), "obsync-apk-"));
		github(SHA_ABC, "new");
		await expect(ensureApk(dir, "1.2.3")).rejects.toThrow(`sha256 ${SHA_NEW}, the release states ${SHA_ABC}`);
		expect(existsSync(join(dir, apkName("1.2.3")))).toBe(false);
	});
});
