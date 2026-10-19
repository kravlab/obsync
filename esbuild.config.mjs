// Bundles src/main.ts into main.js, the one script Obsidian loads.
// `node esbuild.config.mjs production` builds once, minified; without an
// argument it watches and rebuilds with inline source maps.
import esbuild from "esbuild";
import process from "node:process";
import { existsSync } from "node:fs";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";

// The Dropbox app key is never written in the repository. It comes from the
// environment or from a git-ignored .env file (the environment wins), and
// esbuild bundles it into main.js in place of OBSYNC_DROPBOX_APP_KEY.
if (existsSync(".env")) process.loadEnvFile(".env");
const dropboxAppKey = process.env.OBSYNC_DROPBOX_APP_KEY;
if (!dropboxAppKey) {
	console.error("Set OBSYNC_DROPBOX_APP_KEY, in the environment or in .env, to the plugin's Dropbox app key.");
	process.exit(1);
}

// Obsidian provides these at runtime; bundling them would ship a second copy.
const external = [
	"obsidian",
	"electron",
	"@codemirror/autocomplete",
	"@codemirror/collab",
	"@codemirror/commands",
	"@codemirror/language",
	"@codemirror/lint",
	"@codemirror/search",
	"@codemirror/state",
	"@codemirror/view",
	"@lezer/common",
	"@lezer/highlight",
	"@lezer/lr",
	...builtinModules,
];

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external,
	format: "cjs",
	target: "es2021",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
	define: { OBSYNC_DROPBOX_APP_KEY: JSON.stringify(dropboxAppKey) },
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
