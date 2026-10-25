// Tests live under test/; the engine needs no DOM, so the default Node
// environment is used. Tests of the plugin's windows ask for jsdom in
// their own file (`@vitest-environment jsdom`). The `obsidian` package
// ships typings only, so its imports resolve to a fake, whose shared
// state the setup file resets before each test.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	// The build puts the Dropbox app key here (esbuild.config.mjs); tests talk to a fake Dropbox under this one.
	define: {
		OBSYNC_DROPBOX_APP_KEY: JSON.stringify("test-app-key"),
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("test/fakes/obsidian.ts", import.meta.url)),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		setupFiles: ["test/support/obsidian-setup.ts"],
	},
});
