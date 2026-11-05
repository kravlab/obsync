import { existsSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepo, type TempRepo } from "./support";

vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = "scripts/tracked-files.sh";
// Prints each argument on its own line, so a test reads what the command was given.
const PRINT = ["printf", "%s\\n"];
// Prints a marker once per run, then each argument on its own line.
const PRINT_RUN = ["sh", "-c", 'echo run; printf "%s\\n" "$@"', "sh"];

function lines(output: string): string[] {
	return output.split("\n").filter((line) => line !== "");
}

describe("scripts/tracked-files.sh", () => {
	let repo: TempRepo;

	beforeEach(() => {
		repo = createRepo([SCRIPT]);
	});

	afterEach(() => {
		repo.remove();
	});

	it("appends every tracked file matching the pathspec to the command", () => {
		repo.write("a.md", "a");
		repo.write("docs/b.md", "b");
		repo.write("c.txt", "c");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(result.status).toBe(0);
		expect(lines(result.stdout).sort()).toEqual(["a.md", "docs/b.md"]);
	});

	it("puts the command's own arguments before the files", () => {
		repo.write("a.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", "printf", "%s|", "--flag"]);

		expect(result.stdout).toBe("--flag|a.md|");
	});

	it("runs the command once for all the files", () => {
		repo.write("a.md", "a");
		repo.write("b.md", "b");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", ...PRINT_RUN]);

		expect(lines(result.stdout).filter((line) => line === "run")).toHaveLength(1);
	});

	it("limits the files to a directory pathspec", () => {
		repo.write("src/a.ts", "a");
		repo.write("src/deep/b.ts", "b");
		repo.write("test/c.ts", "c");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["src", ...PRINT]);

		expect(lines(result.stdout).sort()).toEqual(["src/a.ts", "src/deep/b.ts"]);
	});

	it("passes every tracked file for the pathspec '.'", () => {
		repo.write("a.md", "a");
		repo.write("dir/b.txt", "b");
		repo.commit("files");

		const result = repo.run(SCRIPT, [".", ...PRINT]);

		expect(lines(result.stdout).sort()).toEqual(["a.md", "dir/b.txt", SCRIPT]);
	});

	it("includes a file that is staged but not yet committed", () => {
		repo.write("committed.md", "a");
		repo.commit("first");
		repo.write("staged.md", "b");
		repo.git(["add", "staged.md"]);

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(lines(result.stdout).sort()).toEqual(["committed.md", "staged.md"]);
	});

	it("leaves out files git does not track", () => {
		repo.write(".gitignore", "ignored.md\n");
		repo.write("tracked.md", "a");
		repo.write("ignored.md", "b");
		repo.commit("files");
		repo.write("untracked.md", "c");

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(lines(result.stdout)).toEqual(["tracked.md"]);
	});

	it("leaves out a tracked symbolic link", () => {
		repo.write("real.md", "a");
		symlinkSync("real.md", join(repo.dir, "link.md"));
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(lines(result.stdout)).toEqual(["real.md"]);
	});

	it("leaves out a tracked file deleted from the working tree", () => {
		repo.write("kept.md", "a");
		repo.write("gone.md", "b");
		repo.commit("files");
		unlinkSync(join(repo.dir, "gone.md"));

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(lines(result.stdout)).toEqual(["kept.md"]);
	});

	it("keeps file names with spaces as single arguments", () => {
		repo.write("my notes.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", ...PRINT]);

		expect(result.stdout).toBe("my notes.md\n");
	});

	it("keeps a file name containing a newline as a single argument", () => {
		repo.write("two\nlines.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", "sh", "-c", 'echo "$#"', "sh"]);

		expect(result.stdout).toBe("1\n");
	});

	it("exits 0 without running the command when no tracked file matches", () => {
		repo.write("a.txt", "a");
		repo.commit("files");
		const marker = join(repo.dir, "ran");

		const result = repo.run(SCRIPT, ["*.md", "touch", marker]);

		expect(result.status).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	it("exits 0 without running the command when every match is a symlink or deleted", () => {
		repo.write("real.txt", "a");
		symlinkSync("real.txt", join(repo.dir, "link.md"));
		repo.write("gone.md", "b");
		repo.commit("files");
		unlinkSync(join(repo.dir, "gone.md"));
		const marker = join(repo.dir, "ran");

		const result = repo.run(SCRIPT, ["*.md", "touch", marker]);

		expect(result.status).toBe(0);
		expect(existsSync(marker)).toBe(false);
	});

	it("exits with the command's own status", () => {
		repo.write("a.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", "sh", "-c", "exit 7", "sh"]);

		expect(result.status).toBe(7);
	});

	it("fails when the command does not exist", () => {
		repo.write("a.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", "no-such-command-for-tracked-files"]);

		expect(result.status).toBe(127);
	});

	it("runs the command from the repository's toplevel even when started in a subdirectory", () => {
		repo.write("sub/a.md", "a");
		repo.write("top.md", "b");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md", "sh", "-c", 'pwd; printf "%s\\n" "$@"', "sh"], {
			cwd: join(repo.dir, "sub"),
		});

		const [workingDirectory, ...files] = lines(result.stdout);
		expect(workingDirectory).toBe(repo.dir);
		expect(files.sort()).toEqual(["sub/a.md", "top.md"]);
	});

	it("prints the usage and exits 2 when called without arguments", () => {
		const result = repo.run(SCRIPT);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain("usage:");
		expect(result.stderr).toContain("<pathspec> <command> [args...]");
		expect(result.stdout).toBe("");
	});

	it("prints the usage and exits 2 when given a pathspec but no command", () => {
		repo.write("a.md", "a");
		repo.commit("files");

		const result = repo.run(SCRIPT, ["*.md"]);

		expect(result.status).toBe(2);
		expect(result.stderr).toContain("usage:");
	});

	it("fails without running the command outside a git repository", () => {
		repo.write("a.md", "a");
		rmSync(join(repo.dir, ".git"), { recursive: true });
		const marker = join(repo.dir, "ran");

		const result = repo.run(SCRIPT, ["*.md", "touch", marker]);

		expect(result.status).not.toBe(0);
		expect(existsSync(marker)).toBe(false);
	});
});
