// The Android run's phone: the emulator's light virtual device (plan, step
// 14), started by the run and closed at its end, with the release's
// Obsidian installed, its data cleared, a vault made through its welcome
// screen and the built plugin (`dist/`) loaded, driven through its
// WebView's DevTools (devtools.ts). Dropbox's authorize page opens in the
// device's only browser, the WebView shell, driven the same way.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll } from "vitest";
import { selectStrings, type Strings } from "../../../src/ui/i18n/strings";
import { DevToolsPage } from "./devtools";
import { evalProgram, readAnswer } from "./obsidian-cli";
import { ensureApk, typedObsidianVersion } from "./obsidian-release";
import { CALL_MS, POLL_CALL_MS, reloadedInLanguageProgram, reloadInLanguageProgram, untilAnswered, type LanguagePage } from "./page";
import { endGroupWithProcess, signalGroup } from "./process-group";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
/** What the Android run keeps on this machine, git-ignored: the APK, the system image, the device. */
const ANDROID_ROOT = join(REPO_ROOT, ".e2e", "android");
/** The system image without Google's apps, unpacked by hand (plan, step 14). */
const SYSTEM_IMAGE = join(ANDROID_ROOT, "sys-img", "x86_64");
/** The virtual devices' folder, `ANDROID_AVD_HOME`. */
const AVD_HOME = join(ANDROID_ROOT, "avd");
/** The emulator's console port, which names the device for adb: one no other emulator uses by default. */
const CONSOLE_PORT = 5584;
const SERIAL = `emulator-${CONSOLE_PORT}`;
const OBSIDIAN_PACKAGE = "md.obsidian";
const OBSIDIAN_ACTIVITY = `${OBSIDIAN_PACKAGE}/.MainActivity`;
/**
 * Obsidian's app storage, where a vault made in "App storage" lives: on
 * external storage, which `pm clear` leaves, so a vault from an earlier run
 * would turn the welcome screen into the vault list.
 */
const OBSIDIAN_APP_STORAGE = `/sdcard/Android/data/${OBSIDIAN_PACKAGE}/files`;
const BROWSER_PACKAGE = "org.chromium.webview_shell";
/** The vault's name, which is also the default name the connect window offers for a new Remote folder. */
const VAULT_NAME = "e2e";
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

/** How long the emulator may take to boot: about 30 s was seen; 3 min only fails a hang. */
const BOOT_TIMEOUT_MS = 180_000;
/** How long Obsidian or the browser may take to open DevTools after launch: a few seconds were seen. */
const DEVTOOLS_TIMEOUT_MS = 60_000;
/** How long one adb command may take; installing the APK is the longest, a few seconds. */
const ADB_TIMEOUT_MS = 120_000;
/** How long the emulator may take to exit once told to. */
const EXIT_TIMEOUT_MS = 30_000;
/** How long Obsidian may take to reload in another language: not measured on the phone (1.6 s on the desktop); 60 s only fails a hang. */
const RELOAD_TIMEOUT_MS = 60_000;

/** The Android SDK folder, from the environment, as Android's own tools take it. */
function sdkRoot(): string {
	const root = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
	if (!root) throw new Error("Set ANDROID_SDK_ROOT (or ANDROID_HOME) to the Android SDK folder");
	return root;
}

/** The emulator's virtual device, named by `SEAMSYNC_E2E_AVD` in the environment or `.env`. */
function avdName(): string {
	const name = process.env.SEAMSYNC_E2E_AVD;
	if (!name) throw new Error("Set SEAMSYNC_E2E_AVD, in the environment or in .env, to the virtual device in .e2e/android/avd");
	return name;
}

/**
 * The abstract socket `/proc/net/unix` lists for the WebView DevTools of
 * process `pid`, or undefined while it has opened none.
 */
export function devToolsSocket(procNetUnix: string, pid: number): string | undefined {
	const name = `webview_devtools_remote_${pid}`;
	return procNetUnix.split("\n").some((line) => line.trimEnd().endsWith(`@${name}`)) ? name : undefined;
}

/** The local port `adb forward tcp:0 …` chose, from what it printed. */
export function forwardedPort(stdout: string): number {
	const text = stdout.trim();
	if (!/^\d+$/.test(text)) throw new Error(`adb forward printed no port: ${text}`);
	return Number(text);
}

/** The `versionName` `dumpsys package` states for an installed app, or undefined. */
export function installedVersion(dumpsys: string): string | undefined {
	return /versionName=(\S+)/.exec(dumpsys)?.[1];
}

/**
 * The phones started and not yet stopped: a start the hook timeout cut
 * short still runs, and its emulator is stopped through this set.
 */
const RUNNING = new Set<AndroidPhone>();

/** The emulator with Obsidian open on a fresh vault and the plugin loaded. */
export class AndroidPhone implements LanguagePage {
	/** Called by stop(): unties the emulator from the run, which otherwise kills it on exit, Ctrl+C or SIGTERM. */
	private readonly untie: () => void;
	private obsidian: DevToolsPage | undefined;
	/** The emulator's failure to start at all, e.g. a missing binary. */
	private spawnError: Error | undefined;
	/** The stop under way, so a second call waits for it instead of stopping again. */
	private stopping: Promise<void> | undefined;
	/** The plugin's id, from the built manifest; set once it loads. */
	pluginId = "";

	/**
	 * Takes the just spawned `emulator`, whose exit `exited` resolves on, and
	 * ties it to the run (see `untie`).
	 */
	private constructor(
		private readonly emulator: ChildProcess,
		private readonly exited: Promise<void>,
	) {
		emulator.once("error", (error) => (this.spawnError = error));
		const { pid } = emulator;
		this.untie = pid === undefined ? () => undefined : endGroupWithProcess(pid);
		RUNNING.add(this);
	}

	/**
	 * Boots the virtual device, installs Obsidian's APK when the installed
	 * version is another, clears Obsidian's data and app storage, turns the network on,
	 * makes the vault through the welcome screen (Create a vault, Continue
	 * without sync, App storage) and loads the built plugin, written into
	 * the vault through Obsidian's adapter and turned on through its
	 * (undocumented) `app.plugins`. A failed start closes the emulator.
	 */
	static async start(): Promise<AndroidPhone> {
		if (existsSync(join(REPO_ROOT, ".env"))) process.loadEnvFile(join(REPO_ROOT, ".env"));
		if (!existsSync(join(REPO_ROOT, "dist", "main.js"))) throw new Error("dist/main.js is missing: build the plugin first");
		if (!existsSync(join(SYSTEM_IMAGE, "system.img"))) throw new Error(`no system image in ${SYSTEM_IMAGE} (plan, step 14)`);
		const name = avdName();
		if ((await adbHost("devices")).includes(SERIAL)) throw new Error(`${SERIAL} already runs: close it first`);
		const apk = await ensureApk(ANDROID_ROOT, await typedObsidianVersion(REPO_ROOT));

		const log = openSync(join(ANDROID_ROOT, "emulator.log"), "w");
		// -no-snapshot: a full boot, no snapshot loaded or saved, so no state of an earlier run comes back.
		const args = ["-avd", name, "-sysdir", SYSTEM_IMAGE, "-port", String(CONSOLE_PORT), "-no-audio", "-no-snapshot", "-no-boot-anim"];
		// A process group of its own, so stop() ends the emulator's helpers too.
		const child = spawn(join(sdkRoot(), "emulator", "emulator"), args, {
			env: { ...process.env, ANDROID_AVD_HOME: AVD_HOME },
			detached: true,
			stdio: ["ignore", log, log],
		});
		closeSync(log);
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		const phone = new AndroidPhone(child, exited);
		try {
			await phone.booted();
			if (installedVersion(await adb("shell", "dumpsys", "package", OBSIDIAN_PACKAGE)) !== (await typedObsidianVersion(REPO_ROOT))) {
				await adb("install", "-r", apk);
			}
			await adb("shell", "pm", "clear", OBSIDIAN_PACKAGE);
			await adb("shell", "rm", "-rf", OBSIDIAN_APP_STORAGE);
			await adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
			await phone.openObsidian();
			await phone.makeVault();
			await phone.loadPlugin();
			return phone;
		} catch (error) {
			await phone.stop();
			throw error;
		}
	}

	/**
	 * The value `body` returns in Obsidian's page (see `evalProgram`). A
	 * failure quotes the page's error only, never the program: a program may
	 * hold the app key.
	 */
	async eval(body: string, timeoutMs = CALL_MS): Promise<unknown> {
		if (!this.obsidian) throw new Error("Obsidian's page is not open");
		return readAnswer(await this.obsidian.evaluate(evalProgram(body), timeoutMs));
	}

	/**
	 * The plugin's strings in Obsidian's language: moment's locale stands in
	 * for `getLanguage()`, which an eval cannot reach (see the desktop's
	 * `DesktopObsidian.strings`).
	 */
	async strings(): Promise<Strings> {
		return selectStrings(String(await this.eval("return moment.locale();")));
	}

	/**
	 * Sets Obsidian's language, or with `null` removes it, and reloads its page
	 * (see `reloadInLanguageProgram`); resolves once the plugin has loaded
	 * again, and fails after RELOAD_TIMEOUT_MS with the last failure. Should the
	 * WebView close DevTools' connection on the reload, the page is opened
	 * over DevTools again.
	 */
	async setLanguage(language: string | null): Promise<void> {
		await this.eval(reloadInLanguageProgram(language));
		await untilAnswered(
			async () => {
				if (this.obsidian?.isClosed()) this.obsidian = await DevToolsPage.open(await forwardDevTools(OBSIDIAN_PACKAGE));
				return this.eval(reloadedInLanguageProgram(language, this.pluginId), POLL_CALL_MS);
			},
			{
				timeoutMs: RELOAD_TIMEOUT_MS,
				what: language === null ? "Obsidian did not reload with no language set" : `Obsidian did not reload in ${language}`,
			},
		);
	}

	/**
	 * The value `body` returns in the page the browser shows, an eval body as
	 * for Obsidian, without its helpers' guarantees across a navigation: a
	 * call cut short by the page navigating fails, and the caller asks again.
	 */
	async browserEval(body: string): Promise<unknown> {
		const page = await DevToolsPage.open(await forwardDevTools(BROWSER_PACKAGE));
		try {
			return readAnswer(await page.evaluate(evalProgram(body), CALL_MS));
		} finally {
			page.close();
		}
	}

	/** Brings Obsidian back to the front, as a user switching back from the browser does. */
	async showObsidian(): Promise<void> {
		await adb("shell", "am", "start", "-n", OBSIDIAN_ACTIVITY);
	}

	/** Sends Obsidian to the background, as a user pressing Home does. */
	async goHome(): Promise<void> {
		await adb("shell", "input", "keyevent", "KEYCODE_HOME");
	}

	/**
	 * Closes the browser, so the next page it opens is the only one: a page
	 * left from an earlier login still shows that login's used code.
	 */
	async closeBrowser(): Promise<void> {
		await adb("shell", "am", "force-stop", BROWSER_PACKAGE);
	}

	/**
	 * Opens Obsidian again after its process died (Android ends it on a
	 * crash), on the same vault, and waits until the plugin is loaded again.
	 */
	async reopen(): Promise<void> {
		this.obsidian?.close();
		await adb("forward", "--remove-all").catch(() => undefined);
		await this.openObsidian();
		await this.eval(
			`await until(() => window.app?.workspace?.layoutReady === true && app.plugins.plugins[${JSON.stringify(this.pluginId)}] !== undefined, 60000, "the plugin loaded again");`,
			90_000,
		);
	}

	/** Turns the device's network off (airplane mode) or on, and waits until Obsidian's page sees it. */
	async setNetwork(on: boolean): Promise<void> {
		await adb("shell", "cmd", "connectivity", "airplane-mode", on ? "disable" : "enable");
		await this.eval(`await until(() => navigator.onLine === ${on}, 30000, "navigator.onLine to be ${on}");`);
	}

	/** Whether Obsidian's process still runs. */
	async obsidianRuns(): Promise<boolean> {
		return (await adb("shell", "pidof", OBSIDIAN_PACKAGE).catch(() => "")).trim() !== "";
	}

	/**
	 * Closes DevTools, adb's forwards and the emulator (through its console,
	 * then SIGKILL); a second call waits for the first.
	 */
	stop(): Promise<void> {
		this.stopping ??= this.stopNow();
		return this.stopping;
	}

	/** What stop() does, once. */
	private async stopNow(): Promise<void> {
		this.obsidian?.close();
		await adb("forward", "--remove-all").catch(() => undefined);
		if (this.spawnError === undefined && this.emulator.exitCode === null && this.emulator.signalCode === null) {
			await adb("emu", "kill").catch(() => undefined);
			const ended = await Promise.race([this.exited.then(() => true), delay(EXIT_TIMEOUT_MS).then(() => false)]);
			if (!ended && this.emulator.pid !== undefined) {
				signalGroup(this.emulator.pid, "SIGKILL");
				await this.exited;
			}
		}
		this.untie();
		RUNNING.delete(this);
	}

	/** Opens Obsidian's activity and its page over DevTools. */
	private async openObsidian(): Promise<void> {
		await adb("shell", "am", "start", "-n", OBSIDIAN_ACTIVITY);
		this.obsidian = await DevToolsPage.open(await forwardDevTools(OBSIDIAN_PACKAGE));
	}

	/** Resolves once Android reports its boot complete; fails if the emulator did not start, exits, or BOOT_TIMEOUT_MS passes. */
	private async booted(): Promise<void> {
		const end = Date.now() + BOOT_TIMEOUT_MS;
		while (Date.now() < end) {
			if (this.spawnError) throw new Error(`the emulator did not start: ${this.spawnError.message}`);
			if (this.emulator.exitCode !== null || this.emulator.signalCode !== null) {
				throw new Error(`the emulator exited while booting; see ${join(ANDROID_ROOT, "emulator.log")}`);
			}
			const done = await adb("shell", "getprop", "sys.boot_completed").catch(() => "");
			if (done.trim() === "1") return;
			await delay(1000);
		}
		throw new Error(`the emulator did not boot within ${BOOT_TIMEOUT_MS} ms`);
	}

	/** Makes the vault through Obsidian's welcome screen, in the app's own storage (no Android permission), and waits for its workspace. */
	private async makeVault(): Promise<void> {
		await this.eval(
			`
			const pick = (text) => until(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === text), 20000, "the " + text + " button");
			(await pick("Create a vault")).click();
			(await pick("Continue without sync")).click();
			const appStorage = await until(
				() => [...document.querySelectorAll(".mobile-onboarding-radio-option")].find((o) => o.querySelector(".mobile-onboarding-radio-option-title")?.textContent === "App storage"),
				20000,
				"the App storage option",
			);
			appStorage.click();
			const name = document.querySelector("input");
			name.value = ${JSON.stringify(VAULT_NAME)};
			name.dispatchEvent(new Event("input", { bubbles: true }));
			(await pick("Create a vault")).click();
			// The page stays; Obsidian makes window.app first and its workspace a moment later.
			await until(() => window.app?.workspace?.layoutReady === true, 60000, "the vault's workspace");`,
			120_000,
		);
	}

	/** Writes the built plugin into the vault and turns it on; fails unless it loads. */
	private async loadPlugin(): Promise<void> {
		const manifest = JSON.parse(await readFile(join(REPO_ROOT, "dist", "manifest.json"), "utf8")) as { id?: unknown };
		if (typeof manifest.id !== "string") throw new Error("dist/manifest.json has no id");
		const files: Record<string, string> = {};
		for (const file of PLUGIN_FILES) files[file] = await readFile(join(REPO_ROOT, "dist", file), "utf8");
		const loaded = await this.eval(`
			const dir = app.vault.configDir + "/plugins/" + ${JSON.stringify(manifest.id)};
			if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
			for (const [name, text] of Object.entries(${JSON.stringify(files)})) await app.vault.adapter.write(dir + "/" + name, text);
			await app.plugins.loadManifests();
			await app.plugins.setEnable(true);
			await app.plugins.enablePluginAndSave(${JSON.stringify(manifest.id)});
			return Object.keys(app.plugins.plugins);`);
		if (!Array.isArray(loaded) || !loaded.includes(manifest.id)) throw new Error(`the plugin did not load: ${JSON.stringify(loaded)}`);
		this.pluginId = manifest.id;
	}
}

/**
 * The phone for the calling scenario file: started before its tests and
 * closed after them, `beforeStop` first (only for a phone that started),
 * its failure failing the file without keeping the emulator open. A start
 * the hook timeout cut short is stopped too. The returned function gives
 * the phone to a test.
 */
export function useAndroidPhone(options: { readonly beforeStop?: (phone: AndroidPhone) => Promise<void> } = {}): () => AndroidPhone {
	let phone: AndroidPhone | undefined;
	beforeAll(async () => {
		phone = await AndroidPhone.start();
	});
	afterAll(async () => {
		try {
			if (phone) await options.beforeStop?.(phone);
		} finally {
			await Promise.all([...RUNNING].map((running) => running.stop()));
		}
	});
	return () => {
		if (!phone) throw new Error("the phone did not start");
		return phone;
	};
}

/**
 * Forwards a free local port to the DevTools socket of `app`'s WebView,
 * once the app runs and has opened it, and returns the port.
 */
async function forwardDevTools(app: string): Promise<number> {
	const end = Date.now() + DEVTOOLS_TIMEOUT_MS;
	while (Date.now() < end) {
		const pid = Number((await adb("shell", "pidof", app).catch(() => "")).trim().split(/\s+/)[0]);
		if (pid > 0) {
			const socket = devToolsSocket(await adb("shell", "cat", "/proc/net/unix"), pid);
			if (socket) return forwardedPort(await adb("forward", "tcp:0", `localabstract:${socket}`));
		}
		await delay(500);
	}
	throw new Error(`${app} opened no DevTools socket within ${DEVTOOLS_TIMEOUT_MS} ms`);
}

/** What adb prints for `args`, run against the run's emulator. */
async function adb(...args: string[]): Promise<string> {
	return adbHost("-s", SERIAL, ...args);
}

/** What adb prints for `args`, as given. */
async function adbHost(...args: string[]): Promise<string> {
	const { stdout } = await promisify(execFile)(join(sdkRoot(), "platform-tools", "adb"), args, {
		timeout: ADB_TIMEOUT_MS,
		maxBuffer: 16 * 1024 * 1024,
	});
	return stdout;
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
