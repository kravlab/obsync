// The desktop run (`pnpm test:e2e:desktop`): scenarios that drive a real
// Obsidian, started by the run itself (test/e2e/support/desktop-obsidian.ts).
// No fake `obsidian` module and no jsdom: the tests run in Node and talk to
// Obsidian through its CLI. Scenario files run one after another, each with
// an Obsidian of its own, so two windows never compete for the screen.
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/e2e/desktop/**/*.test.ts"],
		fileParallelism: false,
		// A scenario waits on a real window; 2 min only fails a hang.
		testTimeout: 120_000,
		// The first run downloads and extracts Obsidian (about 140 MB) in beforeAll.
		hookTimeout: 600_000,
		// The manual checks this run covers, each printed in the summary even if its file fails to load.
		reporters: ["default", ["./test/e2e/support/check-reporter.ts", { checks: [3, 8, 14] }]],
	},
});
