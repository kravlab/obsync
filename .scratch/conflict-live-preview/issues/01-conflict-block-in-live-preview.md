# A conflict block renders as a heading and a quote in Live Preview

Status: resolved

## Problem

In Obsidian's editor (Live Preview), a conflict block the plugin writes
is read as Markdown, not as the block it is:

- `=======` is a setext underline, so the line above it (the last line of
  the local side) renders as a heading;
- `>>>>>>> Remote` is seven `>`, so it renders as a quote nested seven
  levels deep;
- the line after the block has no blank line before it, so it joins that
  quote as a lazy continuation line.

Reading view shows the block correctly: one panel with both sides and
the text around it.

`styles.css` undoes the font size, weight, line height and decoration on
the block's own lines (`.obsync-conflict-marker`, `-local`, `-remote`),
but the lines still carry Obsidian's heading and quote classes, the
heading's margin still shows, and the line after the block has none of
the plugin's classes.

## To decide

How the editor should show the block's lines: plain text, as the
conflict action row expects, or a style of the plugin's own. The fix
lives in the plugin's CodeMirror 6 extension
(`/obsidian-dev-rules` covers editor extensions).

## Comments

2026-10-27, decided by the user: the block's format stays git's; the
editor shows each marker line as a block of its own holding the line's
text, in place of the editor's line. Seen in Obsidian first: `>>>>>>>`
shows as seven quote bars with its `>` transparent, and Obsidian writes
a hanging indent into the element of a line starting with `>` after each
render, which no style outweighs; it leaves alone an element that is not
one of the editor's lines. The side lines stay Markdown: the heading
`=======` makes of the line above it loses its spacing and letter
spacing in styles.css, as its size and weight already did, and the lines
after the block up to a blank line, which Markdown reads as part of the
quote, get `obsync-conflict-after`, whose quote bar, type and colours
styles.css undoes.

2026-10-27, after the review, decided by the user: as Live Preview does
with all Markdown, a marker line the cursor or a selection is on is the
editor's line again, still marked, and edited as typed; pressing the
block puts the cursor where it was pressed, not a selection of the whole
block. `obsync-conflict-after` stops at a line starting a quote of the
note's own, which keeps its bar, and styles.css undoes only lazy quote
lines.

- 2026-10-27: Implemented in commit `3cb34d7` (fix(conflicts): show marker lines plain in editor) on `main`. Ticket closed.
