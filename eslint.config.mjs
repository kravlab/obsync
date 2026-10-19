// ESLint flat config: the ruleset the Obsidian community scanner runs, plus
// sentence-case checks for the English string module (src/ui/i18n/en.ts).
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// main.js is esbuild output; *.mjs are build and tool configs outside
	// the TypeScript project; .agents/ and .claude/ hold vendored agent
	// skills, not plugin code.
	{ ignores: ["main.js", "*.mjs", ".agents/", ".claude/"] },
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},
]);
