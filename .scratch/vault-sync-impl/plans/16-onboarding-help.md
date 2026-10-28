# Plan: 16 Onboarding and help

Ticket: `.scratch/vault-sync-impl/issues/16-onboarding-and-help.md`
Parent spec: `.scratch/vault-sync/spec.md`, "Status, notices, guidance" (onboarding, help, language; stories 97, 98, 100)
Branch: `feat/onboarding-help` (new, from `main` at `4dde314`)
Status: plan and decisions approved 2026-10-28

## Facts checked

- **Connect completion.** The connect window calls `onConnected()` for both `connected` and `reconnected` (`src/ui/connect-modal.ts`); `main.ts` then reloads the settings tab and syncs at once, which shows a new Connection's First sync preview.
- **Sync window tabs.** `SyncTab = "conflicts" | "skipped" | "activity"` (`src/ui/sync-window.ts`).
- **Strings.** No onboarding or help text exists in `en.ts` / `ru.ts` yet.

## Decisions (approved)

1. **When onboarding shows.** Right after a new Connection (`connected`, not `reconnected`). No stored flag: connecting happens once per Connection, and devices connected before this ticket do not see it. The sync, and with it the First sync preview, starts once the onboarding is closed; the onboarding is shown through the status indicator, so a preview asked for by any sync meanwhile waits behind it, and an unload closes it and syncs nothing.
2. **Onboarding window.** Its own modal: a title, the four practices as a list, and "Got it". Reopenable from help.
3. **Where help lives.** A fourth tab "Help" in the Sync window; in settings a "Help" row whose button opens the Sync window at that tab; and a "Show help" command. One help view, reachable from both settings and the Sync window.
4. **Help content**, in sections with headings, after a "Show the four habits again" button: the four practices; Conflict blocks (clearing them: Keep, Keep both, Edit…) and Conflict copies (compare, move what is needed, delete the copy); outside edits are best effort and the Metadata folder `.obsync` must not be touched; configuration categories with the secrets warning and the restart; what never syncs (dot-names, the workspace layout) and skipped files with their reasons (ignore list, name, case, size). Shared settings and devices (ticket 15) are not added: the ticket does not ask for them.
5. **Texts** in English and Russian, one key per item.
6. **Manual check** of both languages on desktop and a phone is not possible in the devcontainer; it is noted on the ticket as left to do by hand, as ticket 14 did.
7. **Branch** `feat/onboarding-help`; the uncommitted devcontainer changes in the working tree are not this task's and are never staged.
8. **Review:** one `code-review` at the end.

## Seams

1. The pure help content (`helpSections(strings)`): sections and items in English and Russian.
2. The onboarding modal (jsdom): the practices, and "Got it" closing it.
3. The Sync window (jsdom, `test/plugin/sync-window.test.ts`): the Help tab and reopening the onboarding from it.
4. The connect window (jsdom, `test/ui/connect-modal.test.ts`): `onConnected` tells a new Connection from a reconnect.
5. The settings tab (jsdom): the Help row opens help.

## Steps

- [x] 1. Strings in English and Russian, and `helpSections` (seam 1).
- [x] 2. The onboarding modal (seam 2).
- [x] 3. The Help tab in the Sync window, with the onboarding button (seam 3).
- [x] 4. The connect window tells the kind of connection; `main.ts` shows onboarding after a new Connection, then syncs; the "Show help" command and the settings row (seams 4, 5).
- [x] 5. Full tests, lint, `code-review`, close the ticket, commit. The e2e flows on Android and the pair close the onboarding after connecting; they were not run here (they need Obsidian on the host). All review findings were fixed or settled by choice on 2026-10-28: the onboarding goes through `StatusIndicator` (closed on unload, the First sync preview waits behind it), the help texts on Conflict blocks, Conflict copies, configuration conflicts and skipped files match the engine, the button reads "Show the four habits again" and sits at the top of the tab, and the Russian test checks every text; the lowercase "synced" stays, since the sentence-case lint refuses a capital inside a sentence.
