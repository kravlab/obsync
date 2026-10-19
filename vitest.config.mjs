// Tests live under test/; the engine needs no DOM, so the default Node
// environment is used.
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
});
