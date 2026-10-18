# First provider choice

Type: grilling
Status: open
Blocked by: 15

## Question

Which provider is implemented for the first release? Google Drive is not required. Choose the one that is simplest to implement well and to connect on desktop, Android and iOS. Weigh:

- engine fit: change feed, revision tokens, conditional writes, name rules, and how much fallback code it forces;
- auth and onboarding on mobile without a server;
- app review and verification burden;
- setup steps for the user;
- how many users already have an account with it;
- risks that need prototyping.

Inputs: [Provider contract](05-provider-contract.md) (which optional Capabilities a candidate offers and how much engine fallback it leaves), [Provider capabilities survey](01-provider-capabilities-survey.md), [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md), [Provider onboarding and auth for a serverless plugin](15-provider-onboarding-and-auth.md).
