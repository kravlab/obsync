// Prettier's options, for every file type it formats (TypeScript, JSON,
// Markdown, YAML, CSS). Tabs, as the code already has. The width is the one
// that rewrites the fewest existing lines, measured over src/, test/ and
// scripts/ (the default 80 would rewrite nearly every file). Quotes,
// semicolons and trailing commas are Prettier's defaults, which the code
// already follows.
/** @type {import("prettier").Config} */
export default {
	useTabs: true,
	printWidth: 135,
};
