<!-- markdownlint-disable MD041 -->

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Workflow handoffs

`/grill-with-docs` must stop after the interview and documentation updates.
Do not call `/to-spec`, `/to-tickets`, `/implement`, or modify source code automatically.

After completing `/grill-with-docs`, `/to-spec`, `/to-tickets`, or `/implement`,
end with `Next command: <command>` and one sentence explaining why that command
fits the current artifacts, unresolved decisions, scope, and completion state.
Recommend exactly one applicable command, or `Next command: none` when the
workflow is complete. Treat the usual
`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` sequence as
conditional: skip any unnecessary phase, and recommend a different relevant
skill when it must resolve a prerequisite first. Recommend only; never invoke
the next command automatically.

`/implement` and `/implement-spec` are not done until every ticket they
implemented is closed as described in `docs/agents/issue-tracker.md`
("Closing an implementation ticket"). The pinned skills do not say this
themselves, so this rule applies on top of them.

### Plugin development skills

Project-level skills in `.agents/skills/` (pinned in `skills-lock.json`) for building this Obsidian plugin:

- **`obsidian`**: Obsidian plugin guidelines: `eslint-plugin-obsidianmd` rules, lifecycle and memory cleanup, `requestUrl` instead of `fetch`, UI standards, community submission. Use for any work on `main.ts`, `manifest.json` or Obsidian API code.
- **`obsidian-dev-rules`**: reference mirrored from docs.obsidian.md: Vault and Editor APIs, events, CodeMirror 6 editor extensions, settings/views/modals, release. Manual only: invoke `/obsidian-dev-rules` (e.g. for the conflict editor's CM6 extension).
- **`obsidian-cli`**: drives a running Obsidian through its CLI: reload the plugin, run JavaScript, capture errors, take screenshots, inspect the DOM. Needs Obsidian open with the CLI enabled, so it works on the host, not in the devcontainer.
- **`vitest`**: Vitest reference: config, module mocking (e.g. mocking `requestUrl` from `obsidian`), fake timers, coverage. Use when writing or running tests.

## Session links

Everything you publish stays free of Claude Code session links
(`claude.ai/code/session_…`): commit messages, PR and issue bodies and
titles, comments, review replies, files. GitHub tooling may append a
footer carrying one after you post: re-read every PR, issue or comment
you create or edit, and remove the link before going on.
