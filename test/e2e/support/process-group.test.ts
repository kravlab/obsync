import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Signal } from "./process-group";

const MODULE = fileURLToPath(new URL("./process-group.ts", import.meta.url));
/** How long the process may take to end: well under a second was seen. */
const ENDING_LIMIT_MS = 5000;

/**
 * Whether `pid` is a running process. A killed process that nobody has
 * reaped yet, as when its orphan went to a PID 1 that never reaps, is a
 * zombie: it has ended, although signal 0 still reaches it.
 */
function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		// The state is the first field after the parenthesised command name.
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return stat[stat.lastIndexOf(")") + 2] !== "Z";
	} catch {
		return false;
	}
}

/**
 * Runs a Node process that starts a detached `sleep` deaf to SIGTERM and SIGINT in a group of its own
 * and ties it to itself with `endGroupWithProcess` (unless `untie`), then
 * ends as `end` says: by `signal` sent from here, or by exiting. Answers
 * whether the sleep is still alive afterwards, and how the process ended.
 */
async function sleepAfter(end: { signal: Signal } | "exit", untie = false): Promise<{ alive: boolean; code: number | null; signal: string | null }> {
	const program = `
		import { spawn } from "node:child_process";
		import { endGroupWithProcess } from ${JSON.stringify(MODULE)};
		// Deaf to SIGTERM and SIGINT, as a hung emulator may be: only SIGKILL ends it.
		const sleep = spawn("sh", ["-c", "trap '' TERM INT; exec sleep 60"], { detached: true, stdio: "ignore" });
		const untie = endGroupWithProcess(sleep.pid);
		if (${String(untie)}) untie();
		console.log(sleep.pid);
		if (${JSON.stringify(end === "exit")}) process.exit(0);
		setInterval(() => {}, 1000);`;
	const node = spawn(process.execPath, ["--input-type=module", "-e", program], { stdio: ["ignore", "pipe", "inherit"] });
	const pid = await new Promise<number>((resolve) => node.stdout.once("data", (data: Buffer) => resolve(Number(String(data).trim()))));
	const ended = new Promise<{ code: number | null; signal: string | null }>((resolve) => node.once("exit", (code, signal) => resolve({ code, signal })));
	if (end !== "exit") node.kill(end.signal);
	// A process that does not end by itself is killed here, so the test fails instead of hanging.
	const stuck = setTimeout(() => node.kill("SIGKILL"), ENDING_LIMIT_MS);
	const how = await ended;
	clearTimeout(stuck);
	// The group is signalled synchronously before the process ends; give the kernel a moment to reap.
	await new Promise((resolve) => setTimeout(resolve, 200));
	const alive = isRunning(pid);
	if (alive) process.kill(-pid, "SIGKILL");
	return { alive, ...how };
}

describe("a process group tied to the run's process", () => {
	it("ends when the process exits", async () => {
		expect(await sleepAfter("exit")).toMatchObject({ alive: false, code: 0 });
	});

	it("ends on Ctrl+C, and the process still ends by that signal", async () => {
		expect(await sleepAfter({ signal: "SIGINT" })).toMatchObject({ alive: false, signal: "SIGINT" });
	});

	it("ends on SIGTERM, and the process still ends by that signal", async () => {
		expect(await sleepAfter({ signal: "SIGTERM" })).toMatchObject({ alive: false, signal: "SIGTERM" });
	});

	it("is left alone once untied", async () => {
		expect(await sleepAfter("exit", true)).toMatchObject({ alive: true, code: 0 });
	});
});
