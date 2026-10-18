# First provider auth design

Type: grilling
Status: open
Blocked by: 03, 15, 16

## Question

How does the user connect the provider chosen in [First provider choice](16-first-provider-choice.md) on each platform? Decide:

- the credential model: an OAuth client shipped with the plugin, one the user registers, or access keys / app passwords;
- the login or redirect flow per platform;
- the scope or permissions requested;
- where credentials are stored;
- what the user sees when credentials stop working.

The decision must stay inside that provider and fit a provider-neutral "connect / disconnect" model that later providers can follow, built around the connect step of the [Provider contract](05-provider-contract.md): authorize, then pick or create the Remote root, or accept a root the provider fixes itself such as an App Folder. Inputs:

- [Provider onboarding and auth for a serverless plugin](15-provider-onboarding-and-auth.md) covers Dropbox, OneDrive, WebDAV and S3.
- If Google Drive is chosen, [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md) applies. It leaves desktop loopback + PKCE, and on mobile either the device flow or a hosted static redirect page (whether the project may host such a page is part of this decision). The scope choice there is `drive.file`, which cannot see files created in the web UI, versus the restricted `drive`, which needs verification.
