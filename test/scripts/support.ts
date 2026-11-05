import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Helpers for the tests of the shell scripts under scripts/. Each test gets a
// throwaway git repository holding a copy of the script under test at the
// same relative path, because the scripts `cd` to the repository's toplevel
// and must act on that repository, not on this one.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export interface RunResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

export interface TempDir {
	dir: string;
	/** Deletes the directory. */
	remove: () => void;
}

export interface TempRepo {
	/** The repository's toplevel directory. */
	dir: string;
	/** Writes a file (creating its directories) relative to `dir`. */
	write(path: string, content: string): void;
	/** Runs git in `dir` (or in `cwd`) and returns its stdout; throws when git fails. */
	git(args: string[], cwd?: string): string;
	/** Stages everything and commits it; returns the new commit's oid. */
	commit(message: string): string;
	/** Runs a script of the repository (relative path) and returns what it did. */
	run(script: string, args?: string[], options?: { cwd?: string; input?: string }): RunResult;
	/** Deletes the repository. */
	remove: () => void;
}

/**
 * The environment the scripts run in: the test process's, without the GIT_*
 * variables a git hook sets (which would point git at this repository), and
 * with no global or system git configuration. The tools come from mise's
 * shims, which pick their versions by the working directory's mise.toml, so
 * the project's own is named explicitly.
 */
function scriptEnv(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (!name.startsWith("GIT_")) env[name] = value;
	}
	return {
		...env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.com",
		MISE_GLOBAL_CONFIG_FILE: join(repoRoot, "mise.toml"),
	};
}

function spawn(command: string, args: string[], cwd: string, input?: string): RunResult {
	const result = spawnSync(command, args, { cwd, env: scriptEnv(), encoding: "utf8", input });
	if (result.error) throw result.error;
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** An empty directory for a test; `remove` deletes it. */
export function makeTempDir(prefix: string): TempDir {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A new git repository on branch `main` with copies of the given repository scripts (relative paths). */
export function createRepo(scripts: string[]): TempRepo {
	const { dir, remove } = makeTempDir("obsync-scripts-");
	const git = (args: string[], cwd = dir): string => {
		const result = spawn("git", args, cwd);
		if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
		return result.stdout;
	};
	git(["init", "-q", "-b", "main"]);
	for (const script of scripts) {
		mkdirSync(dirname(join(dir, script)), { recursive: true });
		// copyFileSync keeps the executable bit.
		copyFileSync(join(repoRoot, script), join(dir, script));
	}
	return {
		dir,
		write(path, content) {
			mkdirSync(dirname(join(dir, path)), { recursive: true });
			writeFileSync(join(dir, path), content);
		},
		git,
		commit(message) {
			git(["add", "-A"]);
			git(["commit", "-q", "--allow-empty", "-m", message]);
			return git(["rev-parse", "HEAD"]).trim();
		},
		run(script, args = [], options = {}) {
			return spawn(join(dir, script), args, options.cwd ?? dir, options.input);
		},
		remove,
	};
}
