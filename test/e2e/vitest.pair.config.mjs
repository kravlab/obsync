// The pair run (`pnpm test:e2e:pair`): a desktop Obsidian, online, and the
// emulator's phone syncing through one Remote folder of the test account,
// both started by the run itself (test/e2e/support/desktop-obsidian.ts,
// test/e2e/support/android-phone.ts). No fake `obsidian` module and no
// jsdom: the tests run in Node and talk to each Obsidian as the desktop
// and Android runs do. One scenario file, one pair.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// The paths below are relative to the repository root.
	root: fileURLToPath(new URL("../..", import.meta.url)),
	test: {
		include: ["test/e2e/pair/**/*.test.ts"],
		fileParallelism: false,
		// Each check needs the ones before it (a login, the files it brought), so the run stops at the first failure.
		bail: 1,
		// A scenario waits on real devices; 2 min only fails a hang. Longer ones give their own.
		testTimeout: 120_000,
		// Starting Obsidian and booting the emulator, with the first run's downloads, happen in beforeAll.
		hookTimeout: 600_000,
		// The manual checks this run covers, each printed in the summary even if its file fails to load.
		reporters: ["default", ["./test/e2e/support/check-reporter.ts", { checks: [5, 6, 7, 9, 20] }]],
	},
});
