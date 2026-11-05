import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepo, type TempRepo } from "./support";

vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = "scripts/shell.sh";
// shfmt reads its style from .editorconfig, as in the project.
const EDITORCONFIG = "root = true\n\n[*.sh]\nindent_style = space\nindent_size = 2\n";
const CLEAN = '#!/bin/bash\nset -euo pipefail\nif [[ -n ${1:-} ]]; then\n  echo "$1"\nfi\n';
// shellcheck SC2086 (unquoted variable); the formatting is fine.
const SHELLCHECK_ISSUE = "#!/bin/bash\nname=${1:-}\necho $name\n";
// Fine for shellcheck; shfmt would indent with two spaces, not four.
const UNFORMATTED = '#!/bin/bash\nif true; then\n    echo "x"\nfi\n';
const FORMATTED = '#!/bin/bash\nif true; then\n  echo "x"\nfi\n';

describe("scripts/shell.sh", () => {
	let repo: TempRepo;

	function read(path: string): string {
		return readFileSync(join(repo.dir, path), "utf8");
	}

	beforeEach(() => {
		repo = createRepo([SCRIPT]);
		repo.write(".editorconfig", EDITORCONFIG);
	});

	afterEach(() => {
		repo.remove();
	});

	describe("lint", () => {
		it("passes when the tracked shell scripts are clean", () => {
			repo.write("run.sh", CLEAN);
			repo.write("nested/deep/other.sh", CLEAN);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(0);
		});

		it("fails and names the file when shellcheck finds a problem", () => {
			repo.write("bad.sh", SHELLCHECK_ISSUE);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("bad.sh");
			expect(result.stdout).toContain("SC2086");
		});

		it("fails and shows a diff when shfmt would reformat a file", () => {
			repo.write("ugly.sh", UNFORMATTED);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("ugly.sh");
			expect(result.stdout).toMatch(/^\+ {2}echo "x"$/m);
		});

		it("runs shfmt even when shellcheck has already failed", () => {
			repo.write("both.sh", "#!/bin/bash\nif true; then\n    echo $1\nfi\n");
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("SC2086");
			expect(result.stdout).toMatch(/^\+ {2}echo \$1$/m);
		});

		it("changes no file", () => {
			repo.write("ugly.sh", UNFORMATTED);
			repo.commit("scripts");

			repo.run(SCRIPT, ["lint"]);

			expect(read("ugly.sh")).toBe(UNFORMATTED);
		});

		it("ignores tracked files that are not *.sh", () => {
			repo.write("notes.txt", SHELLCHECK_ISSUE);
			repo.write("run.sh", CLEAN);
			repo.commit("files");

			expect(repo.run(SCRIPT, ["lint"]).status).toBe(0);
		});

		it("ignores untracked and git-ignored scripts", () => {
			repo.write(".gitignore", "ignored.sh\n");
			repo.write("run.sh", CLEAN);
			repo.commit("files");
			repo.write("ignored.sh", SHELLCHECK_ISSUE);
			repo.write("untracked.sh", SHELLCHECK_ISSUE);

			expect(repo.run(SCRIPT, ["lint"]).status).toBe(0);
		});

		it("exits 0 when no tracked shell script exists", () => {
			repo.write("notes.txt", "x");
			repo.commit("files");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toBe("");
		});

		it.each([
			".devcontainer/claude/lib.sh",
			".config/mise/conf.d/setup.sh",
			".agents/skills/some-skill/run.sh",
			".claude/hooks/check.sh",
			".scratch/try.sh",
		])("skips the excluded path %s", (path) => {
			repo.write(path, SHELLCHECK_ISSUE);
			repo.write("run.sh", CLEAN);
			repo.commit("files");

			const result = repo.run(SCRIPT, ["lint"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toBe("");
		});

		it("does not skip a path that only resembles an excluded one", () => {
			repo.write("docs/.claude/x.sh", SHELLCHECK_ISSUE);
			repo.commit("files");

			// An exclusion is anchored at the repository root.
			expect(repo.run(SCRIPT, ["lint"]).status).toBe(1);
		});

		it("takes only the given files when there are arguments", () => {
			repo.write("bad.sh", SHELLCHECK_ISSUE);
			repo.write("good.sh", CLEAN);
			repo.commit("scripts");

			expect(repo.run(SCRIPT, ["lint", "good.sh"]).status).toBe(0);
			expect(repo.run(SCRIPT, ["lint", "bad.sh"]).status).toBe(1);
		});

		it("takes a given file by its exact name, not as a glob", () => {
			// As a pathspec, a[1].sh would match a1.sh instead.
			repo.write("a[1].sh", CLEAN);
			repo.write("a1.sh", SHELLCHECK_ISSUE);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint", "a[1].sh"]);

			expect(result.status).toBe(0);
			expect(result.stdout).not.toContain("a1.sh");
		});

		it("skips a given file that is in an excluded path", () => {
			repo.write(".claude/hooks/check.sh", SHELLCHECK_ISSUE);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint", ".claude/hooks/check.sh"]);

			expect(result.status).toBe(0);
		});

		it("skips a given file that git does not track", () => {
			repo.write("run.sh", CLEAN);
			repo.commit("scripts");
			repo.write("untracked.sh", SHELLCHECK_ISSUE);

			expect(repo.run(SCRIPT, ["lint", "untracked.sh"]).status).toBe(0);
		});

		it("works when started in a subdirectory of the repository", () => {
			repo.write("sub/bad.sh", SHELLCHECK_ISSUE);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["lint"], { cwd: join(repo.dir, "sub") });

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("sub/bad.sh");
		});
	});

	describe("format", () => {
		it("rewrites a badly formatted tracked script", () => {
			repo.write("ugly.sh", UNFORMATTED);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["format"]);

			expect(result.status).toBe(0);
			expect(read("ugly.sh")).toBe(FORMATTED);
		});

		it("leaves a formatted script as it is", () => {
			repo.write("run.sh", CLEAN);
			repo.commit("scripts");

			repo.run(SCRIPT, ["format"]);

			expect(read("run.sh")).toBe(CLEAN);
		});

		it("does not report shellcheck problems", () => {
			repo.write("bad.sh", SHELLCHECK_ISSUE);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, ["format"]);

			expect(result.status).toBe(0);
			expect(result.stdout).toBe("");
			expect(read("bad.sh")).toBe(SHELLCHECK_ISSUE);
		});

		it("leaves excluded, untracked and non-shell files unchanged", () => {
			repo.write(".claude/hooks/check.sh", UNFORMATTED);
			repo.write("notes.txt", UNFORMATTED);
			repo.commit("files");
			repo.write("untracked.sh", UNFORMATTED);

			const result = repo.run(SCRIPT, ["format"]);

			expect(result.status).toBe(0);
			expect(read(".claude/hooks/check.sh")).toBe(UNFORMATTED);
			expect(read("notes.txt")).toBe(UNFORMATTED);
			expect(read("untracked.sh")).toBe(UNFORMATTED);
		});

		it("formats only the given files when there are arguments", () => {
			repo.write("a.sh", UNFORMATTED);
			repo.write("b.sh", UNFORMATTED);
			repo.commit("scripts");

			repo.run(SCRIPT, ["format", "a.sh"]);

			expect(read("a.sh")).toBe(FORMATTED);
			expect(read("b.sh")).toBe(UNFORMATTED);
		});

		it("makes a following lint pass", () => {
			repo.write("ugly.sh", UNFORMATTED);
			repo.commit("scripts");
			expect(repo.run(SCRIPT, ["lint"]).status).toBe(1);

			repo.run(SCRIPT, ["format"]);

			expect(repo.run(SCRIPT, ["lint"]).status).toBe(0);
		});

		it("exits 0 when no tracked shell script exists", () => {
			repo.write("notes.txt", "x");
			repo.commit("files");

			expect(repo.run(SCRIPT, ["format"]).status).toBe(0);
		});
	});

	describe("usage", () => {
		it.each([[[]], [["check"]], [["lint-all"]], [[""]], [["LINT"]]])("prints the usage and exits 2 for the mode %j", (args) => {
			repo.write("bad.sh", UNFORMATTED);
			repo.commit("scripts");

			const result = repo.run(SCRIPT, args);

			expect(result.status).toBe(2);
			expect(result.stderr).toContain("usage:");
			expect(result.stderr).toContain("lint|format [file.sh...]");
			expect(result.stdout).toBe("");
			expect(read("bad.sh")).toBe(UNFORMATTED);
		});

		it("rejects a bad mode before looking at the files", () => {
			// Nothing is tracked, which would exit 0 for a valid mode.
			const result = repo.run(SCRIPT, ["bogus", "x.sh"]);

			expect(result.status).toBe(2);
		});
	});
});
