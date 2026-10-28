// The runs' Obsidian, from the official assets of a release, kept under the
// git-ignored `.e2e/`: for the desktop the AppImage, extracted, so it runs
// with a settings folder of the run's own and never touches the user's
// Obsidian (plan, step 0); for the emulator the APK.
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const RELEASES = "obsidianmd/obsidian-releases";

/** The paths of an extracted Obsidian: the app, and the CLI that talks to it. */
export interface ObsidianInstall {
	readonly app: string;
	readonly cli: string;
}

/** The AppImage asset of Obsidian `version` for Node's `arch`. */
export function appImageName(version: string, arch: string): string {
	if (arch === "x64") return `Obsidian-${version}.AppImage`;
	if (arch === "arm64") return `Obsidian-${version}-arm64.AppImage`;
	throw new Error(`no Obsidian AppImage for ${arch}`);
}

/** The Android APK asset of Obsidian `version`. */
export function apkName(version: string): string {
	return `Obsidian-${version}.apk`;
}

/**
 * The hex sha256 that `release`, as GitHub's API answers for a release,
 * states for its asset `name` (`digest: "sha256:…"`).
 */
export function releaseDigest(release: unknown, name: string): string {
	if (typeof release !== "object" || release === null || !("assets" in release) || !Array.isArray(release.assets)) {
		throw new Error(`not a release: ${JSON.stringify(release)}`);
	}
	const assets = release.assets as unknown[];
	const asset = assets.find((item): item is { digest?: unknown } => isRecord(item) && item.name === name);
	if (!asset) throw new Error(`the release has no asset ${name}`);
	const digest = asset.digest;
	if (typeof digest !== "string" || !digest.startsWith("sha256:")) throw new Error(`the release states no sha256 for ${name}`);
	return digest.slice("sha256:".length);
}

/** The hex sha256 of the file at `path`. */
export async function sha256Of(path: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(createReadStream(path), hash);
	return hash.digest("hex");
}

/** The Obsidian version the plugin is typed against: `obsidian` in package.json's devDependencies. */
export async function typedObsidianVersion(repoRoot: string): Promise<string> {
	const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
		devDependencies?: Record<string, string>;
	};
	const version = manifest.devDependencies?.obsidian;
	if (!version) throw new Error("package.json has no obsidian devDependency");
	return version;
}

/**
 * Obsidian `version`, extracted under `root` (`<root>/obsidian-<version>-<arch>/`).
 * The first time, it downloads the release's AppImage from GitHub, checks it
 * against the sha256 the release states, and extracts it with the AppImage's
 * own `--appimage-extract`; the AppImage is then deleted. A folder already
 * there is used as it is.
 */
export async function ensureObsidian(root: string, version: string): Promise<ObsidianInstall> {
	const name = appImageName(version, process.arch);
	const dir = join(root, `obsidian-${version}-${process.arch}`);
	const install = { app: join(dir, "squashfs-root", "obsidian"), cli: join(dir, "squashfs-root", "obsidian-cli") };
	if (existsSync(install.app)) return install;

	// Built in a folder of its own and renamed at the end, so a broken download never looks installed.
	const building = `${dir}.partial`;
	await rm(building, { recursive: true, force: true });
	await mkdir(building, { recursive: true });
	const appImage = join(building, name);
	await downloadAsset(version, name, appImage);
	await chmod(appImage, 0o755);
	await promisify(execFile)(appImage, ["--appimage-extract"], { cwd: building, maxBuffer: 64 * 1024 * 1024 });
	await rm(appImage);
	await rename(building, dir);
	return install;
}

/**
 * The path of Obsidian `version`'s APK under `root`. It is downloaded from
 * GitHub and checked against the sha256 the release states, which is kept
 * beside it (`<apk>.sha256`); an APK already there is used, with no
 * request, while its bytes still have that sha256, and downloaded again
 * otherwise.
 */
export async function ensureApk(root: string, version: string): Promise<string> {
	const name = apkName(version);
	const apk = join(root, name);
	const digestFile = `${apk}.sha256`;
	if (existsSync(apk) && existsSync(digestFile) && (await sha256Of(apk)) === (await readFile(digestFile, "utf8"))) return apk;
	await mkdir(root, { recursive: true });
	// Written under another name and renamed at the end, so a broken download never looks complete.
	const partial = `${apk}.partial`;
	const digest = await downloadAsset(version, name, partial);
	await rename(partial, apk);
	await writeFile(digestFile, digest);
	return apk;
}

/**
 * Downloads the asset `name` of Obsidian `version`'s release to `path` and
 * returns its sha256, failing unless it is the one the release states.
 */
async function downloadAsset(version: string, name: string, path: string): Promise<string> {
	const releaseUrl = `https://api.github.com/repos/${RELEASES}/releases/tags/v${version}`;
	const release: unknown = await (await fetchOk(releaseUrl, { Accept: "application/vnd.github+json" })).json();
	const expected = releaseDigest(release, name);
	const download = await fetchOk(`https://github.com/${RELEASES}/releases/download/v${version}/${name}`);
	if (!download.body) throw new Error(`no body downloading ${name}`);
	await pipeline(Readable.fromWeb(download.body as ReadableStream<Uint8Array>), createWriteStream(path));
	const actual = await sha256Of(path);
	if (actual !== expected) throw new Error(`${name}: sha256 ${actual}, the release states ${expected}`);
	return actual;
}

/** `url` fetched with `headers`, refusing an answer other than 2xx. */
async function fetchOk(url: string, headers: Record<string, string> = {}): Promise<Response> {
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response;
}

/** Whether `value` is a plain object, whose fields can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
