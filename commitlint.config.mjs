// commitlint checks each commit message in the commit-msg hook (lefthook.yml):
// Conventional Commits, plus the length limits below. 50 and 72 are the
// usual limits for a subject and a body line, so `git log` and review tools
// show a message whole.
export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"header-max-length": [2, "always", 50],
		"body-max-line-length": [2, "always", 72],
	},
};
