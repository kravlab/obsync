// One desktop Obsidian for a scenario file of the desktop run: the extracted
// release (obsidian-release.ts) started on a settings folder and a vault the
// run creates under `.e2e/runs/`, with the built plugin (`dist/`) in it,
// driven through the Obsidian CLI's `eval` (obsidian-cli.ts).
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll } from "vitest";
import { selectStrings, type Strings } from "../../../src/ui/i18n/strings";
import {
	CALL_MS,
	PAGE_HELPERS,
	POLL_CALL_MS,
	reloadedInLanguageProgram,
	reloadInLanguageProgram,
	untilAnswered,
	type LanguagePage,
} from "./page";
import { evalProgram, parseEvalAnswer } from "./obsidian-cli";
import { ensureObsidian, typedObsidianVersion, type ObsidianInstall } from "./obsidian-release";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
/** Everything the runs keep on this machine; git-ignored. */
const E2E_ROOT = join(REPO_ROOT, ".e2e");
/** The vault's folder name, which is also its name for the CLI's `vault=`. */
const VAULT_NAME = "vault";
/** The files of the built plugin, as Obsidian loads them from its folder. */
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

/**
 * How long Obsidian may take to start, or to reload, before it answers
 * the CLI. Seen: about 2 s to start or to reload into phone emulation,
 * 1.6 s to reload in another language. 60 s leaves room for a loaded
 * machine, so only a hang fails.
 */
const START_TIMEOUT_MS = 60_000;
/** How long Obsidian may take to exit after SIGTERM before it is killed. */
const EXIT_TIMEOUT_MS = 10_000;
/** How many lines of Obsidian's log a failed start quotes. */
const LOG_LINES_QUOTED = 20;

/** A desktop Obsidian started for a scenario file, with the plugin loaded. */
export class DesktopObsidian implements LanguagePage {
	/** Removed by stop(): ends Obsidian if the run itself ends first, e.g. on Ctrl+C. */
	private readonly killOnExit: () => void;
	/** Why the process could not be started, once `spawn` says so. */
	private spawnError: Error | undefined;

	private constructor(
		private readonly install: ObsidianInstall,
		private readonly runDir: string,
		/** The plugin's id, from the built manifest. */
		readonly pluginId: string,
		private readonly online: boolean,
		private readonly child: ChildProcess,
		private readonly exited: Promise<void>,
	) {
		child.once("error", (error) => (this.spawnError = error));
		const { pid } = child;
		this.killOnExit = () => {
			if (pid !== undefined) signalGroup(pid, "SIGKILL");
		};
		process.once("exit", this.killOnExit);
	}

	/**
	 * Starts Obsidian on a new settings folder and vault under
	 * `.e2e/runs/<time>-<name>/`. The vault holds the built plugin, listed in
	 * `community-plugins.json`; the settings list the vault as open and turn
	 * the CLI on, so no one has to click. Community plugins are then turned
	 * on through Obsidian's own (undocumented) `app.plugins`, as restricted
	 * mode is kept in the window's localStorage, not in a file. Resolves once
	 * the plugin is loaded.
	 *
	 * Unless `online` is set, Obsidian runs in a network namespace of its own
	 * (`unshare --user --net`), and so does every CLI call, so nothing sent
	 * from there leaves the machine: a run that needs no login never reaches
	 * Dropbox, not even with a request meant to fail.
	 *
	 * A failed start ends Obsidian, deletes the run's folder and fails with
	 * the end of Obsidian's log.
	 */
	static async start(name: string, options: { readonly online?: boolean } = {}): Promise<DesktopObsidian> {
		if (!existsSync(join(REPO_ROOT, "dist", "main.js"))) throw new Error("dist/main.js is missing: build the plugin first");
		const install = await ensureObsidian(E2E_ROOT, await typedObsidianVersion(REPO_ROOT));
		const runDir = join(E2E_ROOT, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}`);
		const online = options.online ?? false;
		let obsidian: DesktopObsidian | undefined;
		try {
			const pluginId = await builtPluginId();
			await prepareRun(runDir, pluginId);
			const log = openSync(join(runDir, "obsidian.log"), "w");
			// A process group of its own, so stop() ends Electron's helper processes too.
			// unshare execs Obsidian in place, so the child is Obsidian itself either way.
			const [command, args] = withNetwork(online, install.app, []);
			const child = spawn(command, args, { env: environment(runDir), detached: true, stdio: ["ignore", log, log] });
			closeSync(log);
			const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
			obsidian = new DesktopObsidian(install, runDir, pluginId, online, child, exited);
			await obsidian.answering();
			// Obsidian asks whether to trust the author of a vault opened for the first time
			// with plugins. They are on without it, and the prompt left open covers the
			// workspace: a click or a hit test there would land on it, not on the note.
			const loaded = await obsidian.eval(`
				${PAGE_HELPERS}
				await app.plugins.setEnable(true);
				await app.plugins.enablePluginAndSave(${JSON.stringify(pluginId)});
				await closeModals();
				return Object.keys(app.plugins.plugins);`);
			if (!Array.isArray(loaded) || !loaded.includes(pluginId)) throw new Error(`the plugin did not load: ${JSON.stringify(loaded)}`);
			// Checked without sending anything, before any scenario can send.
			if (!online && (await obsidian.eval("return navigator.onLine;")) !== false) {
				throw new Error("Obsidian started with no network has one: unshare did not cut it off");
			}
			return obsidian;
		} catch (error) {
			const log = await logTail(runDir);
			if (obsidian) await obsidian.stop();
			else await removeRun(runDir);
			throw new Error(`Obsidian did not start: ${String(error)}${log ? `\nEnd of Obsidian's log:\n${log}` : ""}`);
		}
	}

	/**
	 * The value `body`, the body of an async function, returns in Obsidian's
	 * window (see `evalProgram`). The window is brought to the front first:
	 * one without focus gets no animation frames, and Obsidian renders
	 * (Reading view, closing windows) in them, so a run left behind other
	 * windows would wait on nothing. Fails at once if this Obsidian has
	 * exited, and with the CLI's own words, not the whole program, if the
	 * call fails.
	 */
	async eval(body: string, timeoutMs = CALL_MS): Promise<unknown> {
		this.mustRun();
		const program = evalProgram(`
			const shownWindow = require("@electron/remote").getCurrentWindow();
			shownWindow.show();
			shownWindow.focus();
			${body}`);
		const [command, args] = withNetwork(this.online, this.install.cli, [`vault=${VAULT_NAME}`, "eval", `code=${program}`]);
		let stdout: string;
		try {
			({ stdout } = await promisify(execFile)(command, args, {
				env: environment(this.runDir),
				timeout: timeoutMs,
				maxBuffer: 16 * 1024 * 1024,
			}));
		} catch (error) {
			this.mustRun();
			const failed = error as { code?: unknown; signal?: unknown; stdout?: string; stderr?: string };
			const said = `${failed.stdout ?? ""}${failed.stderr ?? ""}`.trim();
			const firstLine = body.trim().split("\n")[0];
			throw new Error(
				`Obsidian CLI failed (exit ${String(failed.code)}, signal ${String(failed.signal)}) running "${firstLine}": ${said}`,
			);
		}
		return parseEvalAnswer(stdout);
	}

	/**
	 * The plugin's strings in Obsidian's language. The plugin reads it with
	 * `getLanguage()`, which an eval cannot reach (it is no global and
	 * `obsidian` cannot be required there), so moment's locale stands in:
	 * on the run's fresh settings both are English (`en`, with no language
	 * stored), and a scenario comparing text fails if they ever differ.
	 */
	async strings(): Promise<Strings> {
		return selectStrings(String(await this.eval("return moment.locale();")));
	}

	/**
	 * Sets Obsidian's language, or with `null` removes it, and reloads the
	 * window (see `reloadInLanguageProgram`); resolves once the plugin has
	 * loaded again.
	 */
	async setLanguage(language: string | null): Promise<void> {
		await this.eval(reloadInLanguageProgram(language));
		await this.answering(reloadedInLanguageProgram(language, this.pluginId));
	}

	/**
	 * Turns this Obsidian into a phone: Obsidian's mobile emulation takes a
	 * window at least 1024 px wide for a tablet, so the window is first made
	 * 400 px wide through Electron, then emulation is turned on (the
	 * `EmulateMobile` key `app.emulateMobile` sets) and the window reloads.
	 * Resolves once the reloaded window is a phone with the plugin loaded.
	 */
	async becomePhone(): Promise<void> {
		await this.eval(`
			const electronWindow = require("@electron/remote").getCurrentWindow();
			electronWindow.setMinimumSize(300, 400);
			electronWindow.setSize(400, 860);
			localStorage.setItem("EmulateMobile", "1");
			setTimeout(() => location.reload(), 100);`);
		await this.answering(`
			return activeDocument.body.classList.contains("is-phone") && ${JSON.stringify(this.pluginId)} in app.plugins.plugins;`);
	}

	/** Ends Obsidian (SIGTERM, then SIGKILL) and deletes the run's folder. */
	async stop(): Promise<void> {
		process.off("exit", this.killOnExit);
		const { pid } = this.child;
		if (pid !== undefined && this.child.exitCode === null && this.child.signalCode === null) {
			signalGroup(pid, "SIGTERM");
			const ended = await Promise.race([this.exited.then(() => true), delay(EXIT_TIMEOUT_MS).then(() => false)]);
			if (!ended) {
				signalGroup(pid, "SIGKILL");
				await this.exited;
			}
		}
		await removeRun(this.runDir);
	}

	/**
	 * Resolves once the CLI reaches this Obsidian and `ready`, an eval body,
	 * returns true; fails after START_TIMEOUT_MS with the last failure, or at
	 * once if Obsidian exits or cannot be started.
	 */
	private answering(ready = "return true;"): Promise<void> {
		return untilAnswered(
			// Asked only once this Obsidian holds its socket, so a call never meets a half-started one.
			async () => {
				if (!existsSync(join(this.runDir, "config", "obsidian", "SingletonSocket"))) throw new Error("no SingletonSocket yet");
				return (await this.eval(ready, POLL_CALL_MS)) === true;
			},
			{ timeoutMs: START_TIMEOUT_MS, what: "Obsidian did not answer", mustGoOn: () => this.mustRun() },
		);
	}

	/** Throws if this Obsidian could not be started or has exited. */
	private mustRun(): void {
		if (this.spawnError) throw new Error(`Obsidian could not be started: ${this.spawnError.message}`);
		if (this.child.exitCode !== null || this.child.signalCode !== null) {
			throw new Error(`Obsidian exited (code ${String(this.child.exitCode)}, signal ${String(this.child.signalCode)})`);
		}
	}
}

/**
 * One Obsidian for the calling scenario file: started before its tests
 * (`name` names the run's folder), with a network only if `online` is set
 * (see `DesktopObsidian.start`), a phone first if `phone` is set, and
 * stopped after them. The returned function gives it to a test.
 */
export function useDesktopObsidian(
	name: string,
	options: { readonly phone?: boolean; readonly online?: boolean } = {},
): () => DesktopObsidian {
	let obsidian: DesktopObsidian | undefined;
	beforeAll(async () => {
		obsidian = await DesktopObsidian.start(name, { online: options.online });
		if (options.phone) await obsidian.becomePhone();
	});
	afterAll(async () => {
		await obsidian?.stop();
	});
	return () => {
		if (!obsidian) throw new Error("Obsidian did not start");
		return obsidian;
	};
}

/** The plugin's id, from the built manifest. */
async function builtPluginId(): Promise<string> {
	const manifest = JSON.parse(await readFile(join(REPO_ROOT, "dist", "manifest.json"), "utf8")) as { id?: unknown };
	if (typeof manifest.id !== "string") throw new Error("dist/manifest.json has no id");
	return manifest.id;
}

/**
 * Writes a run's folder: the vault with the built plugin enabled in
 * `community-plugins.json`, and Obsidian's settings listing that vault as
 * open with the CLI on.
 */
async function prepareRun(runDir: string, pluginId: string): Promise<void> {
	const vault = join(runDir, VAULT_NAME);
	const pluginDir = join(vault, ".obsidian", "plugins", pluginId);
	await mkdir(pluginDir, { recursive: true });
	for (const file of PLUGIN_FILES) await cp(join(REPO_ROOT, "dist", file), join(pluginDir, file));
	await writeFile(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify([pluginId]));
	await mkdir(join(runDir, "config", "obsidian"), { recursive: true });
	const settings = { vaults: { [randomBytes(8).toString("hex")]: { path: vault, ts: Date.now(), open: true } }, cli: true };
	await writeFile(join(runDir, "config", "obsidian", "obsidian.json"), JSON.stringify(settings));
}

/** Deletes a run's folder; Electron's helpers may still be writing there for a moment after Obsidian ends. */
function removeRun(runDir: string): Promise<void> {
	return rm(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/** The last lines of a run's Obsidian log, or "" if there is none. */
async function logTail(runDir: string): Promise<string> {
	try {
		return (await readFile(join(runDir, "obsidian.log"), "utf8")).trimEnd().split("\n").slice(-LOG_LINES_QUOTED).join("\n");
	} catch {
		return "";
	}
}

/**
 * The command that runs `program` with `args`: as it is when `online`;
 * otherwise in a new user namespace, mapping the current user and group to
 * themselves so it runs as them, and a new network namespace, which holds
 * no interface but loopback.
 */
function withNetwork(online: boolean, program: string, args: readonly string[]): [string, string[]] {
	if (online) return [program, [...args]];
	const { uid, gid } = userInfo();
	return ["unshare", ["--user", `--map-user=${uid}`, `--map-group=${gid}`, "--net", program, ...args]];
}

/** The environment Obsidian and its CLI run in: the run's settings folder in place of the user's. */
function environment(runDir: string): typeof process.env {
	return { ...process.env, XDG_CONFIG_HOME: join(runDir, "config") };
}

/** Sends `signal` to the process group `pid` leads, ignoring a group already gone. */
function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
	try {
		process.kill(-pid, signal);
	} catch (error) {
		if ((error as { code?: unknown }).code !== "ESRCH") throw error;
	}
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
