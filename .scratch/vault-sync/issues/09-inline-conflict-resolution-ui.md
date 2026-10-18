# Inline conflict resolution UI

Type: prototype
Status: resolved
Blocked by: 07

## Question

How should a conflict block look and behave in the Obsidian editor? Starting hypothesis to react to: marker lines are hidden, the two sides are highlighted, and a widget offers "Accept Local" / "Accept Remote" that replaces the whole block with the chosen side; resolving needs no special plugin action, so a normal save is picked up by the next sync. Prototype it (CodeMirror 6 editor extension, see `/obsidian-dev-rules`) and decide: buttons offered (both? accept both?), behaviour in reading view and on touch screens, how the user finds files with conflicts, and whether this UI is part of the first release. Uses the marker format from [Text conflict merge policy](07-text-conflict-merge-policy.md).

Uses the marker syntax fixed in [Text conflict merge policy](07-text-conflict-merge-policy.md): git-style markers labelled with device names (`Remote` when the other device is unknown); old markers are plain text and blocks may nest. JSON files (`.canvas`) never get markers.

## Answer

Decided by reacting to a three-variant prototype. The prototype is on branch `prototype/inline-conflict-ui` (local, never merged), file `.scratch/vault-sync/prototypes/inline-conflict-ui/index.html`. The variants were:

- A: hidden markers with a toolbar;
- B: visible markers with action links;
- C: collapsed chip with a chooser dialog.

Variant B won, with the hand-edit dialog borrowed from C.

1. **Editing view (variant B).** Markers stay visible exactly as they are in the file, and the two sides get a light tint. A row of actions sits above the `<<<<<<<` line. What the editor shows matches the file on disk.
2. **Actions:**
   - "Keep <this device>" and "Keep <other device>", labelled with device names per [Text conflict merge policy](07-text-conflict-merge-policy.md);
   - "Keep both": both sides in order, markers removed;
   - "Edit…": opens a dialog with both sides in a text field for a hand edit.

   Every action is an ordinary edit of the file, which the next sync uploads like any other change. Removing the markers by hand works just the same.
3. **Phones.** The action row becomes a row of buttons at least 44px tall. Markers stay visible.
4. **Reading view.** The plugin renders each block as "Unresolved conflict" with both sides visible and no buttons; resolving happens in editing view. Because the plugin renders reading view itself, the markers never reach Obsidian's markdown rendering. Whether a raw `=======` line would otherwise turn the paragraph above it into a setext heading in Obsidian is unverified and no longer matters.
5. **Finding conflicts.** Opening a file from the shared conflict list jumps to its first block. "Next conflict" and "previous conflict" commands in the command palette move between blocks in the open file. How the list and the status indicator look stays in the map's UI fog.
6. **First release.** This UI is part of it.
