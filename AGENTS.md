## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

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

## Session links

Everything you publish stays free of Claude Code session links
(`claude.ai/code/session_…`): commit messages, PR and issue bodies and
titles, comments, review replies, files. GitHub tooling may append a
footer carrying one after you post: re-read every PR, issue or comment
you create or edit, and remove the link before going on.
