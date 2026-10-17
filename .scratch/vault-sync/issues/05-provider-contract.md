# Provider contract

Type: grilling
Status: open
Blocked by: 04

## Question

What exactly does the sync engine require from every Provider, and what is optional? Fix the set of operations, the identity a Remote file is addressed by, the metadata each file must report (revision, hash, size, modified time), the optional capabilities and how the engine discovers them, and the error categories a Provider must map its failures into. The contract must fit Google Drive without assuming anything only Google Drive offers; check it against the [Provider capabilities survey](01-provider-capabilities-survey.md) and the layout chosen in [Remote layout and change detection](04-remote-layout-and-change-detection.md).
