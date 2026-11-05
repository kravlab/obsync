import { describe, expect, it, vi } from "vitest";
import { FAKE_KEY, LEAK, ZEROS, prePushLine, useGitleaksRepo } from "./gitleaks-support";

vi.setConfig({ testTimeout: 30_000 });

describe("scripts/hooks/gitleaks-pushed.sh, several refs and the output", () => {
	const fx = useGitleaksRepo();

	describe("several refs in one push", () => {
		it("fails when any of them holds a secret", () => {
			fx.repo.git(["switch", "-q", "-c", "clean-branch"]);
			fx.repo.write("a.txt", "clean\n");
			const cleanTip = fx.repo.commit("clean");
			fx.repo.git(["switch", "-q", "-c", "leaky-branch", "main"]);
			fx.repo.write("secret.txt", LEAK);
			const leakyTip = fx.repo.commit("leak");

			const input =
				prePushLine("refs/heads/clean-branch", cleanTip, "refs/heads/clean-branch", ZEROS) +
				prePushLine("refs/heads/leaky-branch", leakyTip, "refs/heads/leaky-branch", ZEROS);

			fx.expectLeak(fx.scan("origin", input));
		});

		it("keeps scanning the lines after a deletion", () => {
			fx.repo.git(["switch", "-q", "-c", "leaky-branch"]);
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			const input =
				prePushLine("(delete)", ZEROS, "refs/heads/old", "1".repeat(40)) +
				prePushLine("refs/heads/leaky-branch", tip, "refs/heads/leaky-branch", ZEROS);

			fx.expectLeak(fx.scan("origin", input));
		});

		it("passes when every ref is clean", () => {
			fx.repo.git(["switch", "-q", "-c", "one"]);
			fx.repo.write("a.txt", "one\n");
			const one = fx.repo.commit("one");
			fx.repo.git(["switch", "-q", "-c", "two", "main"]);
			fx.repo.write("b.txt", "two\n");
			const two = fx.repo.commit("two");

			const input =
				prePushLine("refs/heads/one", one, "refs/heads/one", ZEROS) + prePushLine("refs/heads/two", two, "refs/heads/two", ZEROS);

			fx.expectClean(fx.scan("origin", input));
		});
	});

	describe("output", () => {
		it("redacts the secret it reports", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			const result = fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS));

			expect(result.stdout + result.stderr).not.toContain(FAKE_KEY);
		});

		it("names the file of a finding, with the secret hidden", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("config/secret.txt", LEAK);
			const tip = fx.repo.commit("leak");

			const result = fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS));

			fx.expectLeak(result);
			expect(result.stdout + result.stderr).toContain("config/secret.txt");
			expect(result.stdout + result.stderr).not.toContain(FAKE_KEY);
		});

		it("reports how many commits it scanned and how many findings it made", () => {
			fx.repo.git(["switch", "-q", "-c", "feature"]);
			fx.repo.write("config/secret.txt", LEAK);
			fx.repo.commit("leak");
			fx.repo.write("clean.txt", "clean\n");
			const tip = fx.repo.commit("second commit");

			const result = fx.scan("origin", prePushLine("refs/heads/feature", tip, "refs/heads/feature", ZEROS));

			expect(result.stderr).toContain("2 commits scanned");
			expect(result.stderr).toContain("leaks found: 1");
		});
	});
});
