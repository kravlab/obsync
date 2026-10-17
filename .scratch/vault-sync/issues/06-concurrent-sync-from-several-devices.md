# Concurrent sync from several devices

Type: grilling
Status: open
Blocked by: 01, 04

## Question

What happens when two devices sync against the same Remote at the same time, for example both upload a new version of the same note, or one deletes a folder while the other writes into it? Decide whether the engine relies on conditional writes, a lock or lease on the Remote, re-check-after-write, or accepts a window of risk, and what guarantee the user gets ("no change is ever silently lost" or something weaker). Must work on providers that lack conditional writes, and Google Drive, the first provider, is one of them: it has no documented conditional write and allows duplicate names (see [Provider capabilities survey](01-provider-capabilities-survey.md)).
