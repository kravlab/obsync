import { describe, it, vi } from "vitest";
import { LEAK, ZEROS, prePushLine, useGitleaksRepo } from "./gitleaks-support";

vi.setConfig({ testTimeout: 30_000 });

describe("scripts/hooks/gitleaks-pushed.sh, a new branch", () => {
	const fx = useGitleaksRepo();

	describe("a new branch (remote oid all zeros)", () => {
		it("passes when the new commits hold no secret", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("a.txt", "no secret here\n");
			const tip = fx.repo.commit("clean");

			fx.expectClean(fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});

		it("fails when a commit no remote branch has holds a secret", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			fx.expectLeak(fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});

		it("finds a secret that a later commit removed again", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");
			fx.repo.write("secret.txt", "removed\n");
			const tip = fx.repo.commit("remove");

			fx.expectLeak(fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});

		it("does not scan commits a remote branch already has", () => {
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak, pushed already");
			fx.repo.git(["push", "-q", "origin", "main"]);
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("a.txt", "clean\n");
			const tip = fx.repo.commit("clean");

			fx.expectClean(fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});

		it("scans against the named remote only", () => {
			fx.addRemote("backup");
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");
			fx.repo.git(["push", "-q", "backup", "feature"]);

			// `backup` has the leak, `origin` does not.
			fx.expectLeak(fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
			fx.expectClean(fx.scan("backup", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});

		it("counts every remote's branches as pushed when given a URL, not a name", () => {
			// git passes the URL in place of a name for a push to a URL; no
			// remote-tracking branch is named after it.
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak, pushed already");
			fx.repo.git(["push", "-q", "origin", "main"]);
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("a.txt", "clean\n");
			const tip = fx.repo.commit("clean");
			const url = fx.repo.git(["remote", "get-url", "origin"]).trim();

			fx.expectClean(fx.scan(url, prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS)));
		});
	});
});
