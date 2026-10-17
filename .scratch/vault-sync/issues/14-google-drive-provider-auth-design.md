# Google Drive provider auth design

Type: grilling
Status: open
Blocked by: 03

## Question

How does the user connect the Google Drive provider on each platform? Decide whose OAuth client is used (one shipped with the plugin, or one the user creates), the redirect flow per platform (research leaves desktop loopback + PKCE, and on mobile either the device flow or a hosted static redirect page, so whether the project may host such a page is part of this decision), the scope (`drive.file` and its blindness to web-created files vs restricted `drive` and its verification), where tokens are stored, and what the user sees when a token can no longer be refreshed. The decision must stay inside the Google Drive provider and fit a provider-neutral "connect / disconnect" model that other providers can follow. Based on [Google Drive auth for a community plugin](03-google-drive-auth-for-community-plugin.md).
