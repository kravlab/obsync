import { describe, it, vi } from "vitest";
import { LEAK, useGitleaksRepo } from "./gitleaks-support";

vi.setConfig({ testTimeout: 30_000 });

describe("scripts/hooks/gitleaks-pushed.sh, run by hand", () => {
	const fx = useGitleaksRepo();

	describe("run by hand, with nothing on stdin", () => {
		it("fails when a local branch has a commit no remote branch has, holding a secret", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");

			fx.expectLeak(fx.scan("origin", ""));
		});

		it("passes when the secret is already on a remote branch", () => {
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak, pushed already");
			fx.repo.git(["push", "-q", "origin", "main"]);

			fx.expectClean(fx.scan("origin", ""));
		});

		it("scans every local branch, not only the checked out one", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");
			fx.repo.git(["switch", "-q", "main"]);

			fx.expectLeak(fx.scan("origin", ""));
		});

		it("counts only the named remote's branches as pushed", () => {
			fx.addRemote("backup");
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");
			fx.repo.git(["push", "-q", "backup", "main"]);

			fx.expectLeak(fx.scan("origin", ""));
			fx.expectClean(fx.scan("backup", ""));
		});

		it("counts every remote's branches as pushed when no remote is named", () => {
			fx.addRemote("backup");
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");
			fx.repo.git(["push", "-q", "backup", "main"]);

			fx.expectClean(fx.scan(undefined, ""));
		});

		it("fails on a secret when no remote is named and nothing is pushed", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");

			fx.expectLeak(fx.scan(undefined, ""));
		});
	});
});
