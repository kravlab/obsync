import { afterEach, beforeEach, expect } from "vitest";
import { createRepo, makeTempDir, type RunResult, type TempDir, type TempRepo } from "./support";

// The fixture of the tests of scripts/hooks/gitleaks-pushed.sh, which are
// split over several files because each gitleaks run takes about a second:
// the files run in parallel.
const SCRIPT = "scripts/hooks/gitleaks-pushed.sh";
export const ZEROS = "0".repeat(40);
// An invented AWS-style access key id: it never worked anywhere, but matches
// the shape gitleaks' aws-access-token rule looks for. (The documentation
// example key AKIAIOSFODNN7EXAMPLE is allowlisted by gitleaks.)
// Built at run time, so this file holds no literal for the project's own
// gitleaks hooks to flag.
export const FAKE_KEY = ["AKIA", "Z3MFQ7XD2LNP5RTV"].join("");
export const LEAK = `aws_access_key_id = ${FAKE_KEY}\n`;

/** The line git's pre-push hook gets on stdin for one ref. */
export function prePushLine(localRef: string, localOid: string, remoteRef: string, remoteOid: string): string {
	return `${localRef} ${localOid} ${remoteRef} ${remoteOid}\n`;
}

export interface GitleaksFixture {
	/** The repository of the running test: `base` is committed and pushed to the remote `origin`. */
	readonly repo: TempRepo;
	/** Registers a new bare repository as remote `name`. */
	addRemote(name: string): void;
	/** Runs the script with the remote's name (none when undefined) as its argument and `input` on stdin. */
	scan(remote: string | undefined, input: string): RunResult;
	expectClean(result: RunResult): void;
	expectLeak(result: RunResult): void;
}

/** Call inside a describe block: sets up a repository with a pushed `base` commit before each test and removes it after. */
export function useGitleaksRepo(): GitleaksFixture {
	let repo: TempRepo;
	let remotes: TempDir[] = [];

	const fixture: GitleaksFixture = {
		get repo() {
			return repo;
		},
		addRemote(name) {
			const remote = makeTempDir("obsync-remote-");
			remotes.push(remote);
			repo.git(["init", "-q", "--bare", remote.dir]);
			repo.git(["remote", "add", name, remote.dir]);
		},
		scan(remote, input) {
			return repo.run(SCRIPT, remote === undefined ? [] : [remote], { input });
		},
		expectClean(result) {
			expect(result.status).toBe(0);
			expect(result.stderr).toContain("no leaks found");
		},
		expectLeak(result) {
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/leaks found: \d+/);
		},
	};

	beforeEach(() => {
		repo = createRepo([SCRIPT]);
		remotes = [];
		fixture.addRemote("origin");
		repo.write("readme.md", "hello\n");
		repo.commit("base");
		// Pushing records refs/remotes/origin/main, which marks `base` as already pushed.
		repo.git(["push", "-q", "origin", "main"]);
	});

	afterEach(() => {
		repo.remove();
		for (const remote of remotes) remote.remove();
	});

	return fixture;
}
