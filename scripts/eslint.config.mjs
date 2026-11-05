// ESLint flat config: the ruleset the Obsidian community scanner runs, plus
// sentence-case checks for the English string module (src/ui/i18n/en.ts).
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// Run as `eslint --config scripts/eslint.config.mjs` from the repository
	// root, so every pattern here is relative to the root. dist/ is build
	// output; *.mjs are build and tool configs outside the TypeScript
	// project, wherever they are; .agents/ and .claude/ hold vendored agent
	// skills, and .scratch/ tickets and local prototype builds, not plugin
	// code; .e2e/ holds what the desktop and Android runs keep locally.
	{ ignores: ["dist/", "**/*.mjs", ".agents/", ".claude/", ".scratch/", ".e2e/"] },
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},
	// The tests' fake of the obsidian module defines Obsidian's element
	// helpers (createEl, createDiv), so it has to build elements without them.
	{
		files: ["test/fakes/obsidian.ts"],
		rules: { "obsidianmd/prefer-create-el": "off" },
	},
	// The desktop and Android runs are Node programs that start and drive
	// Obsidian from outside, not plugin code: they use Node's modules,
	// `process`, `fetch` and Node's timers, which the plugin rules forbid,
	// and write `.obsidian` into the vaults they create, whose
	// configuration folder it is.
	{
		files: ["test/e2e/**/*.ts"],
		languageOptions: { globals: { process: "readonly" } },
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"no-restricted-globals": "off",
			"obsidianmd/hardcoded-config-path": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
	// The tests of scripts/ run the project's shell scripts in throwaway git
	// repositories, not plugin code: they spawn processes and use temporary
	// files and `process`.
	{
		files: ["test/scripts/**/*.ts"],
		languageOptions: { globals: { process: "readonly" } },
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
]);
