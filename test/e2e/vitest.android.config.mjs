// The Android run (`pnpm test:e2e:android`): scenarios on the emulator's
// phone, started by the run itself (test/e2e/support/android-phone.ts). No
// fake `obsidian` module and no jsdom: the tests run in Node and talk to
// Obsidian through its WebView's DevTools. One scenario file, one phone.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// The paths below are relative to the repository root.
	root: fileURLToPath(new URL("../..", import.meta.url)),
	test: {
		include: ["test/e2e/android/**/*.test.ts"],
		fileParallelism: false,
		// A scenario waits on a real phone; 2 min only fails a hang. Longer ones give their own.
		testTimeout: 120_000,
		// Booting the emulator, and the first run's download of Obsidian's APK, happen in beforeAll.
		hookTimeout: 600_000,
		// The manual checks this run covers, each printed in the summary even if its file fails to load.
		reporters: ["default", ["./test/e2e/support/check-reporter.ts", { checks: [1, 2, 3, 14, 16, 17, 19] }]],
	},
});
