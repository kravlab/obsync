# First sync against an existing Remote

Type: grilling
Status: open
Blocked by: 07

## Question

What happens the first time a device syncs, when there is no common ancestor yet? Cases: empty vault + populated Remote, populated vault + empty Remote, both populated (e.g. a second device that already has a copy of the vault, or a reinstall). Decide how identical files are recognised without a full-file conflict, how differing files are handled, whether the user previews or confirms the first sync, and how a device that lost its sync state recovers. Uses the merge policy from [Text conflict merge policy](07-text-conflict-merge-policy.md).
