# Remote layout and change detection

Type: grilling
Status: open
Blocked by: 01, 02

## Question

How is the vault laid out on the Remote, and how does a device find out what changed there since its last sync? Options include: relying on a provider's change feed where it exists, listing the Remote tree and comparing, or keeping a plugin-owned manifest/index on the Remote that devices update. Decide whether the Remote must stay a plain, human-browsable mirror of the vault, what the plugin is allowed to store there besides the vault files, and how the choice degrades on providers without a change feed (see [Provider capabilities survey](01-provider-capabilities-survey.md)).
