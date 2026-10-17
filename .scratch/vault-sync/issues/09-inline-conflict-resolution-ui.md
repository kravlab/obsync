# Inline conflict resolution UI

Type: prototype
Status: open
Blocked by: 07

## Question

How should a conflict block look and behave in the Obsidian editor? Starting hypothesis to react to: marker lines are hidden, the two sides are highlighted, and a widget offers "Accept Local" / "Accept Remote" that replaces the whole block with the chosen side; resolving needs no special plugin action, so a normal save is picked up by the next sync. Prototype it (CodeMirror 6 editor extension, see `/obsidian-dev-rules`) and decide: buttons offered (both? accept both?), behaviour in reading view and on touch screens, how the user finds files with conflicts, and whether this UI is part of the first release. Uses the marker format from [Text conflict merge policy](07-text-conflict-merge-policy.md).
