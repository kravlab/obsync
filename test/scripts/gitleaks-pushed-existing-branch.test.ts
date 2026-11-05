import { describe, expect, it, vi } from "vitest";
import { LEAK, ZEROS, prePushLine, useGitleaksRepo } from "./gitleaks-support";

vi.setConfig({ testTimeout: 30_000 });

describe("scripts/hooks/gitleaks-pushed.sh, an existing or deleted branch", () => {
	const fx = useGitleaksRepo();

	describe("an existing remote branch", () => {
		it("scans the commits from the remote's oid to the local one", () => {
			const remoteOid = fx.repo.git(["rev-parse", "HEAD"]).trim();
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			fx.expectLeak(fx.scan("origin", prePushLine("refs/heads/main", tip, "refs/heads/main", remoteOid)));
		});

		it("passes when only the commits before the remote's oid hold a secret", () => {
			fx.repo.write("secret.txt", LEAK);
			const remoteOid = fx.repo.commit("leak, which the remote has");
			fx.repo.write("a.txt", "clean\n");
			const tip = fx.repo.commit("clean");

			fx.expectClean(fx.scan("origin", prePushLine("refs/heads/main", tip, "refs/heads/main", remoteOid)));
		});

		it("scans an existing branch by the line's oids, not by the remote-tracking refs", () => {
			// origin/main is still at `base`; the push replaces an older oid.
			fx.repo.write("secret.txt", LEAK);
			const remoteOid = fx.repo.commit("leak");
			fx.repo.write("a.txt", "clean\n");
			const tip = fx.repo.commit("clean");

			fx.expectClean(fx.scan("origin", prePushLine("refs/heads/main", tip, "refs/heads/main", remoteOid)));
		});

		it("scans as a new branch when this clone lacks the remote's oid", () => {
			// The remote moved on to a commit never fetched here: the range from
			// it cannot be listed, so what no remote branch has is scanned.
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			fx.expectLeak(fx.scan("origin", prePushLine("refs/heads/main", tip, "refs/heads/main", "1".repeat(40))));
		});
	});

	describe("a deleted branch (local oid all zeros)", () => {
		it("scans nothing and exits 0 even though unpushed commits hold a secret", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			fx.repo.commit("leak");

			const result = fx.scan("origin", prePushLine("(delete)", ZEROS, "refs/heads/old", "1".repeat(40)));

			// gitleaks did not run at all: no scan report either.
			expect(result.status).toBe(0);
			expect(result.stderr).toBe("");
		});
	});
});
