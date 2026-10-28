// Bundles src/main.ts into dist/main.js, the one script Obsidian loads, and
// copies manifest.json and src/styles.css next to it, so dist/ holds exactly
// the files of <vault>/.obsidian/plugins/obsync/.
// `node scripts/esbuild.config.mjs production`, run from the repository
// root as every path here is, builds once, minified; without an argument it
// watches and rebuilds with inline source maps.
import esbuild from "esbuild";
import process from "node:process";
import { copyFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";

const outdir = "dist";

// The files Obsidian loads besides main.js, each from its source to the name
// Obsidian looks for. They are copied after every successful build, so a
// watch rebuild also refreshes them; an edit to one of them alone triggers no
// rebuild.
const pluginFiles = { "manifest.json": "manifest.json", "src/styles.css": "styles.css" };

/** Copies pluginFiles into outdir once a build has written main.js. */
const copyPluginFiles = {
	name: "copy-plugin-files",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length > 0) return;
			for (const [source, name] of Object.entries(pluginFiles)) copyFileSync(source, `${outdir}/${name}`);
		});
	},
};

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
	outfile: `${outdir}/main.js`,
	minify: production,
	define: { OBSYNC_DROPBOX_APP_KEY: JSON.stringify(dropboxAppKey) },
	plugins: [copyPluginFiles],
});

if (production) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
