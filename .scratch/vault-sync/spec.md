# Vault sync plugin: first release

Status: ready-for-agent

Decisions behind this spec live on the vault-sync wayfinder map and its tickets, in ADRs 0001–0004, and in the project glossary, whose vocabulary this spec uses throughout.

## Problem Statement

A person keeps one Obsidian vault on several devices: a desktop or laptop, an Android phone, an iPhone. The laptop is often offline for long stretches, and the phone is used on the move, so the same notes are regularly edited on two devices before either has synced. Existing sync options lose changes in exactly this situation:

- they overwrite one side silently, or scatter conflict copies the user never notices;
- they miss changes made while Obsidian was closed;
- they break on mobile, where an app is frozen or killed in the background and HTTP bodies are held entirely in memory.

The person wants a sync they can trust: nothing they wrote is ever lost without being told, conflicts are visible and easy to resolve, and it works on desktop, Android and iOS with an ordinary cloud account and no server of their own.

## Solution

An Obsidian community plugin that keeps the vault in sync across all of a person's devices through a cloud storage service.

- **The Remote is a mirror.** The vault is mirrored as plain files into a Remote: one folder at the provider, readable in the provider's own UI.
- **One provider first.** The plugin talks to clouds only through a Provider abstraction. The first release implements one provider, Dropbox, using an App Folder. The contract is shaped so that Google Drive, OneDrive, WebDAV and S3-compatible storage can be added later.
- **Text merges itself where it can.** Edits on two devices to different parts of a note merge automatically. Edits to the same lines become a Conflict block, git-style markers labelled with device names, resolved with one tap or by hand.
- **Nothing else is overwritten silently.** Attachments and JSON files that cannot be merged keep both versions, one of them as a Conflict copy.
- **Deletions and renames are safe.** A deleted file that was edited elsewhere comes back, and a sync that would delete many files stops and asks.
- **Interruptions are harmless.** Sync runs when the vault opens, after edits, on a timer, on returning to the app and when the network comes back. It is safe to cut off at any moment.
- **The user can always see the state.** A status entry point (status bar on desktop, ribbon icon on mobile) opens a Sync window with conflicts, skipped files and a short activity log.
- **First-time guidance.** Onboarding guidance and a help section explain how to avoid conflicts, in English and Russian.

## User Stories

### Connecting

1. As a user, I want to connect the plugin to my Dropbox account from inside Obsidian, so that I can start syncing without installing anything else.
2. As a user on a phone, I want the login to work by approving in the browser and pasting a code back, so that it works on Android and iOS the same way as on desktop.
3. As a user, I want the plugin to ask for access only to its own app folder in my Dropbox, so that a bug or a wrong choice cannot touch my other files.
4. As a user, I want to pick an existing Remote or create a new one, named after my vault by default, when connecting, so that each vault I own syncs into its own folder.
5. As a user with several vaults, I want each vault to sync into a separate Remote in the same Dropbox account, so that vaults never mix.
6. As a user connecting a second device, I want to see which folders already hold a Remote, so that I choose the same one as my first device.
7. As a user, I want a short screen on first connect with the four most important practices, so that I avoid the most common causes of conflicts from day one.
8. As a user, I want to be warned when I connect a device while another device is still running its First sync on the same Remote, so that I wait instead of creating avoidable conflicts.
9. As a user, I want to be able to continue anyway after that warning, so that a mark left behind by a crashed device never blocks me for good.
10. As a user, I want my login to be stored securely on each device and never in my vault or on the Remote, so that my credentials do not travel with my notes.
11. As a user, I want each device to log in separately, so that losing one device does not expose the others.
12. As a user, I want the plugin to refuse a login to a different Dropbox account than the one this device was connected to, with an explanation, so that I never mix two accounts' data by accident.
13. As a user, I want to disconnect a device, so that it stops syncing and its login is revoked, without touching my notes or the Remote.
14. As a user, I want other devices to keep syncing when I disconnect one device, so that cleaning up one device does not break the rest.

### First sync

15. As a user setting up a new device, I want a preview before the first sync that shows how many files will be downloaded, uploaded, are identical, and differ, so that nothing surprising happens to my vault.
16. As a user, I want to see the full list of files in that preview, so that I can check what will change.
17. As a user, I want nothing to change until I start the first sync, so that I can back out.
18. As a user, I want the first sync never to delete anything, so that connecting a device can never wipe files on either side.
19. As a user, I want identical files on both sides to be recognised without turning into conflicts, so that connecting a device that already has a copy of the vault is quiet.
20. As a user, I want identical files to be recognised without downloading them when the provider's hash allows it, so that the first sync of a large vault is fast.
21. As a user, I want differing text files to be merged with every difference marked, so that I lose neither version.
22. As a user, I want a one-click option to take the Remote version of every differing file and keep my local versions as Conflict copies, so that I avoid markers in many notes at once.
23. As a user who reinstalled the plugin or lost its data, I want the device to recover through the same first-sync flow, so that recovery is never a special case.
24. As a user, I want two devices that set up the same empty Remote at the same moment not to corrupt its settings, and to be asked to choose if their settings differ.

### Everyday sync

25. As a user, I want the vault to sync when I open it, so that I start from the latest state.
26. As a user, I want my edits to be uploaded shortly after I stop typing, so that they reach my other devices quickly.
27. As a user, I want the plugin to check the Remote periodically while Obsidian is open, so that changes from other devices arrive without my doing anything.
28. As a user, I want a sync when I return to the app and when the network comes back, so that a phone catches up as soon as it can.
29. As a user, I want a "Sync now" command and button, so that I can force a sync before leaving.
30. As a user, I want edits I made while Obsidian was closed, or while offline, to be found and synced, so that nothing depends on the plugin having watched the edit happen.
31. As a mobile user, I want my local changes to be uploaded before downloads, so that my edits are safe even if the phone freezes or kills the app.
32. As a user, I want a sync that was cut off (app backgrounded, network lost, Obsidian closed) to finish its work on the next sync, so that interruptions never leave the vault or the Remote half-changed.
33. As a user, I want only one sync to run at a time on a device, so that triggers firing together never step on each other.
34. As a user, I want being offline to be shown as a calm state, not an error, so that I am not bothered while travelling.
35. As a user, I want the note I am typing in not to change under my cursor; remote changes to it should be applied when I pause, so that typing is never disrupted.
36. As a user, I want large attachments, up to the size ceiling, to sync on phones without crashing the app, so that images and PDFs work everywhere.
37. As a user whose phone still crashes on large transfers, I want to lower the per-request size in settings, so that I can make sync work on my device.

### Text conflicts

38. As a user, I want edits to different parts of a note on two devices to merge automatically, so that I only deal with real conflicts.
39. As a user, I want overlapping edits to appear in the note as a Conflict block with both versions, labelled with the device names, so that I can see exactly what clashed and where it came from.
40. As a user, I want the second label to say "Remote" when the other device is unknown, so that the block is always readable.
41. As a user, I want differences only in line endings or a byte-order mark not to count as conflicts, so that Windows and phones do not fight over invisible characters.
42. As a user, I want the note to stay ordinary markdown with the markers in it, so that I can leave a conflict unresolved without breaking anything.
43. As a user, I want to resolve a conflict by deleting the markers and the unwanted side by hand, so that I am not forced to use plugin buttons.
44. As a user, I want a row of actions above each Conflict block in the editor (keep this device, keep the other device, keep both, edit…), so that I can resolve it in one tap.
45. As a phone user, I want those actions to be big enough to tap (at least 44 px tall), so that resolving works on a touch screen.
46. As a user, I want "Edit…" to open a dialog with both sides in a text field, so that I can combine them by hand.
47. As a user, I want reading view to show an unresolved block clearly, with both versions and no buttons, so that the note still reads well.
48. As a user, I want "next conflict" and "previous conflict" commands, so that I can walk through all blocks in a long note.
49. As a user, I want a note that already has unresolved markers to merge again normally, with old markers kept as plain text, so that nothing is lost even if blocks nest.
50. As a user, I want canvas and other JSON files never to get markers, which would break them; I want a Conflict copy instead, so that Obsidian can always open the file.
51. As a user, I want a clean merge of a JSON file to be applied only if the result is valid JSON, so that a merge never corrupts a canvas.
52. As a user, I want to add my own extensions to the list of files treated as text, so that my other plain-text formats merge too.
53. As a user, I want all my devices to treat the same files as text, so that a file is never merged on one device and copied on another.

### Binary conflicts

54. As a user, I want an image or PDF changed on two devices to keep both versions, with the Remote version under the original name and mine as a Conflict copy next to it, so that I never lose a photo or a document.
55. As a user, I want Conflict copies named after the device and time, so that I can tell where each version came from.
56. As a user, I want the same file added identically on two devices not to be treated as a conflict, so that I do not get pointless copies.
57. As a user, I want a notice when a Conflict copy is created, and the copy listed among conflicts on every device, so that I notice it and clean it up.

### Concurrency between devices

58. As a user, I want the guarantee that no change is silently lost even when two devices sync at the same moment, so that I can trust the plugin.
59. As a user, I want a folder deleted on one device to survive if another device added a file to it at the same time, so that the new file is not lost.
60. As a user, I want each device to have a name I can edit, so that conflict labels and messages say "Phone" or "Laptop" instead of an id.
61. As a user, I want to forget a device I no longer use, so that its records stop holding back cleanup.

### Deletions and renames

62. As a user, I want a file I deleted on one device to be deleted on the others, so that the vault stays tidy.
63. As a user, I want a file deleted on one device but edited on another to come back everywhere, with a notice, so that an edit always beats a delete.
64. As a user, I want remote deletions applied on my device to go to my Obsidian trash according to my trash setting, so that I can recover them.
65. As a user, I want sync to stop and ask me when it would delete many files or a large share of the vault, or the whole vault or Remote, so that a wiped device cannot wipe all the others.
66. As a user, I want that prompt to let me apply the deletions, restore the files, or review the list, so that I decide with full information.
67. As a user, I want to configure the thresholds of that guard, so that it fits the size of my vault.
68. As a user, I want renames and moves to be carried to other devices as renames, so that moved files are not deleted and uploaded again.
69. As a user, I want a file renamed while Obsidian was closed to be recognised as a rename when that is unambiguous, so that it does not turn into a delete and a new file.
70. As a user, I want remote renames applied without rewriting links again on every device, so that one rename does not cause a wave of extra edits and conflicts.
71. As a user, I want a file renamed on one device and edited on another to end up renamed and edited, so that both actions survive.
72. As a user, I want a file renamed on one device and deleted on another to be kept under its new name, with a notice, so that a deliberate rename is not undone.
73. As a user, I want a file renamed differently on two devices to settle on the name already on the Remote, with a notice naming both names, so that my devices agree without losing content.
74. As a user, I want a rename onto a path another device just used to keep both files, mine as a Conflict copy, so that neither file is lost.
75. As a user, I want folder renames to carry their contents, so that reorganising my vault works across devices.

### What syncs

76. As a user, I want all my visible notes and attachments to sync, so that the vault is the same everywhere.
77. As a user, I want hidden files and folders (such as `.git`, `.trash`, `.DS_Store`) never to sync, so that tool and system files stay local.
78. As a user, I want to choose, per device, whether settings and hotkeys, themes and snippets, and plugins are synced, so that, for example, my phone can share my theme but not my desktop-only plugins.
79. As a user enabling plugin sync, I want a warning that other plugins' settings may contain secrets, so that I decide knowingly.
80. As a user, I want my workspace layout never to sync, so that each device keeps its own panes.
81. As a user, I want devices whose configuration folders have different names to share one configuration, so that the setting does not split my config.
82. As a user, I want to be told to restart Obsidian when settings arrive from another device, so that I know how to apply them.
83. As a user, I want a configuration conflict to keep the Remote version and save mine where I can restore it from the conflict list, so that a hidden settings file never silently loses my change.
84. As a user, I want an ignore list of path patterns that applies to all my devices, so that excluded files are excluded everywhere and never look deleted.
85. As a user, I want files above a size ceiling (100 MB by default, adjustable) to be skipped and listed, so that sync never stalls on huge files.
86. As a user, I want files whose names my cloud cannot store to be skipped and reported, or encoded reversibly if I choose that setting for the Remote, so that I can decide between exact names and syncing everything.
87. As a user, I want two files whose names differ only by case to be skipped and reported on a cloud that ignores case, so that one never overwrites the other.

### Status, notices and help

88. As a desktop user, I want a status bar item showing whether sync is synced, syncing, offline, paused or needs reconnecting, with counts of conflicts and skipped files, so that I see the state at a glance.
89. As a mobile user, I want a ribbon icon that opens the same Sync window, so that I can see the state where there is no status bar.
90. As a user, I want "Sync: …" commands, so that I can reach everything even with the ribbon hidden.
91. As a user, I want a Sync window with tabs for conflicts, skipped files and recent activity, so that everything sync-related is in one place.
92. As a user, I want to open a conflicted file from the list and land on its first Conflict block, so that resolving is quick.
93. As a user, I want a short activity log in plain words, with "Copy for a bug report", so that I can understand what happened and report problems.
94. As a user, I want transient notices for restored files, renames to the Remote name, settings that need a restart, new Conflict copies and "reconnect needed", each also kept in the activity log, so that I do not miss them.
95. As a user whose login expired, I want sync paused on that device only, one notice, and a persistent "reconnect needed" state, so that I fix it once without losing local edits.
96. As a user, I want reconnecting with the same account to continue normally, not restart from a First sync, so that a lapsed login is cheap.
97. As a user, I want a help section with all the practices and explanations (conflicts, edits outside the plugin, configuration, skipped files), so that I can look things up later.
98. As a Russian-speaking user, I want the whole interface in Russian when Obsidian is in Russian, so that I can use it comfortably.

### Edits outside the plugin

99. As a user who sometimes edits a file in the Dropbox web UI, I want those edits picked up like any other change where possible, so that occasional outside edits are not lost.
100. As a user, I want the help to say that outside edits are best effort and that the plugin's own Metadata folder must not be touched, so that I know the limits.

## Implementation Decisions

### Architecture and modules

- **Sync engine.** A provider-agnostic module that owns all sync logic: change detection, merge, conflict policies, deletions, renames, the Deletion guard, First sync, settings handling and scheduling. It reaches the outside world only through ports:
  - **Provider:** the contract below.
  - **Local vault:** list and stat entries, including hidden configuration paths through Obsidian's adapter; read and write whole files; trash through `FileManager.trashFile`; rename through `vault.rename`, never `FileManager.renameFile`; vault events as hints only.
  - **Device store:** the Sync snapshot, Base copies, Device ID, the local copies kept on configuration conflicts, and journal read positions. Per-device, never in `data.json` or the vault, never synced.
  - **Secret store:** over Obsidian's `SecretStorage`.
  - **Clock and scheduler.**
  - **UI port:** prompts and notices as calls; the engine awaits user answers.
- **Dropbox provider.** Implements the Provider contract over Dropbox's HTTP API through Obsidian's `requestUrl`.
- **Conflict-block module.** A pure function from document text to the list of Conflict blocks and the edits produced by each action (keep this device, keep the other, keep both, hand edit). It is used by the editor extension and the conflict list.
- **Editor extension.** A CodeMirror 6 extension that styles Conflict blocks, shows the action row (buttons at least 44 px tall on phones), and offers next/previous-conflict commands. A reading-view post-processor renders each block as "Unresolved conflict" with both sides and no buttons.
- **Plugin shell.** Settings, the status bar item (desktop), the ribbon icon (mobile and desktop), commands, the Sync window, modals, notices, onboarding and help, with English and Russian strings chosen by Obsidian's language.

### Provider contract

From the map's Provider contract ticket, refined by the mobile runtime checks:

- **Addressing.** Entries are addressed by Remote path. The provider maps paths to native ids and caches them. Listing entries may carry an opaque stable id, used only as a rename hint.
- **Required operations:** full `list` of the Remote, `read`, `write`, `delete`, `createFolder`, and a connect step:
  - **connect:** authorize, then browse or create folders to choose the Remote root, or accept a root the provider fixes itself;
  - **disconnect:** revoke the credential at the service.
- **Optional Capabilities,** reported after connecting; anything not reported is absent, and nothing is silently ignored:
  - a change feed `changes(cursor)`;
  - conditional write: "only if revision is X" or "only if absent" on `write` and `delete`, never emulated by read-then-write;
  - file move;
  - folder move.
- **Listing and feed entries.**
  - Required: Remote path, kind (file or folder), revision token (files), size.
  - Optional: stable id, a server hash with its algorithm, server mtime (display only).
- **Change feed** returns the current state of each affected path (present with revision X, or deleted) plus a new cursor. Repeats are allowed, and the last one wins. The provider expands folder renames and deletes to the affected paths itself, or reports `cursorLost`.
- **Errors** map to exactly these categories: `auth`, `throttled` (with `retryAfter`), `transient`, `notFound`, `preconditionFailed`, `cursorLost`, `quotaExceeded`, `tooLarge`, `nameNotRepresentable`, `permanent`. The engine retries by category. Only a multi-step transfer (a chunked upload) is completed by the provider itself.
- **Name rules.** The provider declares forbidden characters, reserved names, case-insensitivity and length limits. The engine applies the Remote's name policy.
- **Data transfer.**
  - **Whole buffers.** To the engine, `read` returns and `write` takes the whole file as one buffer: 100 MB in memory was handled on Android and iOS.
  - **Per-request limit.** Internally the provider keeps every single HTTP request body below a per-request limit: under 20 MB by default, user-configurable. It uses chunked uploads (Dropbox upload sessions) and `Range` downloads; Android crashed downloading 30 MB and uploading 50 MB in one request.
  - **Maximum file size.** The provider reports its maximum file size.
- **Metadata folder.** It is read and written through the same operations. The engine excludes it from the vault comparison.

### Remote layout and change detection

- **One vault per Remote.** The Remote is a plain mirror of exactly one vault at the same relative paths. Plugin-owned data lives only in the Metadata folder at the Remote root, whose name starts with a dot. ADR 0002.
- **Change detection.**
  - **Baseline:** a full listing compared with the Sync snapshot.
  - **Change feed:** where available, the feed is used instead. A full listing then runs only on a device's First sync, after `cursorLost`, or on a manual "full reconcile".
  - **No manifest:** there is no shared manifest on the Remote.
- **Changed files.** A file has changed on the Remote when its opaque revision token differs from the Sync snapshot. A changed file is downloaded and compared by the plugin's own content hash; a false alarm costs only a download.
- **Server hashes** decide identity only on an exact algorithm match the plugin can compute locally, which is used during First sync.
- **Folders,** including empty ones, are mirror entries; providers without folders emulate them.

### Concurrency and the no-loss guarantee

- **The guarantee:** no change is silently lost, on any provider.
- **Conditional writes.** With the conditional-write Capability, every `write` and `delete` carries "revision is what my Sync snapshot recorded" or "absent". `preconditionFailed` means re-read the file and treat it as a conflict.
- **Without conditional writes.** Providers without the Capability need Device journals (ADR 0003): intent before write, the resulting revision after it, detect and repair. They are **not implemented in the first release**. The engine refuses to connect a provider that does not report conditional writes. Dropbox supplies the Capability: upload in `update` mode with the known revision, and `delete_v2` with `parent_rev` for files.
- **Devices.** Each device has a random Device ID (created on first connect, stored only on the device) and an editable device name. Both are recorded in the device's own record in the Metadata folder, which also carries the "First sync in progress" mark. The mark expires after a timeout the spec leaves to implementation (see Further Notes).
- **Folder deletion.** A folder is deleted as its known files one by one, then the folder only when a listing shows it empty. Provider-side recursive delete is never used.
- **Shared Remote settings** live in the Metadata folder: the name policy, the text-extension list, the ignore list and the size ceiling.
  - They are re-read at the start of every sync.
  - They change only by explicit user action, written with a precondition.
  - If two changes collide, sync stops until the user picks the value.
  - Changing the name policy is an explicit operation that renames the affected files on the Remote.

### Text merge

- **Merge.** Line-based 3-way merge against the per-device Base. The library must be pure JavaScript, work on mobile, and have no Node built-ins.
- **Conflict blocks** use git syntax: `<<<<<<< <this device name>` … `=======` … `>>>>>>> <other device name or "Remote">`.
- **What counts as text:**
  - an extension from the shared text-extension list, with defaults `.md`, `.txt`, `.canvas`, `.csv` and similar plus user additions;
  - and all three versions decode as UTF-8.
- **Normalisation.** Versions are compared and merged with LF line endings and no BOM; the result is written in the local file's style. Versions that differ only in whether the file ends with a line break (an empty file and one holding only a line break included) merge without a Conflict block, keeping the line break; a version that also differs in other lines is not covered by this.
- **No true Base.** Without a true Base (First sync, lost Sync snapshot), a 2-way merge marks every differing region as a Conflict block and never picks a side. Identical content is no conflict. A Base that is not the true common ancestor is never used.
- **Old markers** are plain text; blocks may nest.
- **JSON files** (`.canvas`, `.json`) never get markers. A clean merge is applied only if it parses as JSON; otherwise the Remote version goes into the file and the local version becomes a Conflict copy.
- **Conflict copy** name: `Name (conflict <device name> YYYY-MM-DD HHmm).ext`, in the same folder, with the time from the device clock. It is an ordinary synced file. A name longer than the provider allows (its longest name, and its longest path less the folder) is cut: the original name first, down to one character, then the device name, then the extension from its end; the date stays whole, and characters are cut as the user sees them. When even the shortest copy name does not fit, no copy is made, the file is skipped as a name the provider cannot store, and both versions stay as they are.

### Binary conflicts

- **Conflict copy.** On a conflict the Remote version keeps the name, and the detecting device uploads its own version as a Conflict copy. No time-based winner is chosen.
- **Identical content** (same plugin hash) is no conflict.
- **Notice.** The creating device shows a notice, and every device lists Conflict copies, recognised by the name pattern, in the conflict list.

### Deletions and renames

- **Detecting deletions.** Deletions are detected from the Sync snapshot; there are no Remote tombstones.
- **An edit beats a delete.** The file is restored everywhere, with a notice.
- **Applying a remote delete locally** uses `FileManager.trashFile`, which respects the user's trash setting. On the Remote it is a normal `delete`, into the provider's trash if it has one.
- **Deletion guard.**
  - Sync stops and prompts when it would delete more than N files or more than P% of the vault, in either direction.
  - A missing vault or Remote root always stops sync.
  - The prompt offers apply, restore or review list.
  - N and P are settings; defaults are left to implementation (see Further Notes).
- **Rename detection:**
  - local: the `rename` event while running, otherwise a vanished path and a new path with a unique content-hash match;
  - remote: the stable id or a hash match;
  - an ambiguous match is treated as a delete plus a create.
- **Applying renames.** Local renames use `vault.rename`. On the Remote a rename uses the move Capability, otherwise write-new then delete-old, ordered so an interrupted move completes on the next sync.
- **Rename combined with other changes:**
  - rename plus an edit: the file is renamed and keeps the edit, merged per the policies if both sides changed it;
  - rename plus a delete: the file is kept renamed, with a notice;
  - two different renames: the Remote name wins, with a notice naming both;
  - a rename onto an occupied path: the Remote file keeps the path, and the local file becomes a Conflict copy.
- **Folder renames** are renames of every entry inside. On the Remote they use one folder move when the provider supports it and nothing inside conflicts.

### First sync

- **Union only.** A device with no Sync snapshot does a First sync: a full listing, then a union in which files on one side are copied to the other. It never deletes, so the Deletion guard does not apply.
- **Preview first.** A summary comes first: to download, to upload, identical, differing. It has a full list and a bulk option, "Remote version for every differing file, keep mine as Conflict copies". Nothing changes until the user starts the sync.
- **A lost Sync snapshot** is a First sync, with re-registration under a new Device ID; the old record ages out.
- **Turning on a configuration category** is a First sync for that category's files.

### Sync triggers and lifecycle

- **Triggers:**
  - vault open (after `onLayoutReady`);
  - the "Sync now" command;
  - a pause after local edits;
  - periodic polling while Obsidian is open;
  - `visibilitychange` → `visible`;
  - `online`.

  `hidden` is not relied on, because Android does not always deliver it. The pause and polling intervals are settings. Triggers collapse into at most one running sync plus one follow-up.
- **No persisted queue.** The Sync snapshot is updated per file only after both sides confirm, and an interrupted sync re-derives its work from vault, Sync snapshot and Remote.
- **Local changes** are found by a full walk on vault open and on every poll: mtime and size first, then hashing what changed. Hidden configuration paths are walked through the adapter, since they produce no events.
- **The open note** is processed after the typing pause. Writing into the open editor must not disturb the cursor; the method is left to implementation.
- **Order of work:** uploads of local changes first, small text before large attachments, then downloads.
- **Offline** shows as a calm state, with backoff retries and no repeated notices.

### Synced file scope

- **Visible files** of the vault sync. Any dot-path never syncs, except the configuration folder below.
- **Configuration folder.**
  - **Per-device categories,** all off by default:
    - settings and hotkeys;
    - themes and snippets;
    - plugins: code plus `data.json`, with a secrets warning.
  - **Always excluded:** workspace layout files and the sync plugin's own folder.
  - **One name on the Remote.** It is stored under one fixed Remote name and mapped to each device's `vault.configDir`. The fixed name is left to implementation.
  - **Settings changes** that arrive are written, and the user is told to restart. Other plugins are not reloaded.
  - **On a configuration conflict** the Remote version wins, and the local version is kept in the sync plugin's folder, restorable from the conflict list.
- **Ignore list:** shared Remote setting of path patterns, empty by default.
- **Size ceiling:** shared Remote setting, 100 MB by default, never above the provider's maximum. Larger files are skipped and listed.
- **Name policy:** shared Remote setting, "skip and report" by default or "encode reversibly". There is one provider-neutral, strictly reversible encoding that changes only characters the provider cannot store; its exact substitutions are left to implementation. Case-only collisions on case-insensitive providers are always skipped and reported.

### Dropbox provider

From the map's First provider choice and First provider auth design tickets, ADR 0004, and the mobile runtime checks:

- **The app.** One Dropbox app registered by the plugin author, with App Folder access. Its app key is bundled in the plugin; there is no client secret.
  - Scopes: `files.metadata.read`, `files.content.read`, `files.content.write`, `account_info.read`.
- **Login, the same on all platforms.**
  1. Open `https://www.dropbox.com/oauth2/authorize` with `response_type=code`, the app key, `token_access_type=offline`, `code_challenge_method=S256` and no `redirect_uri`.
  2. The user pastes the displayed code into the plugin.
  3. Exchange it at `https://api.dropboxapi.com/oauth2/token` with the `code_verifier`.

  The code is single-use, and a reused or expired code (`invalid_grant`) restarts the login.
- **Tokens.**
  - The refresh token is kept in `SecretStorage` per device, and access tokens are refreshed internally.
  - An expired access token is refreshed and the request retried. `invalid_access_token`, or `invalid_grant` on refresh, is reported as `auth`.
  - A second device linking leaves the first device's refresh token working; verified on Android and iOS.
- **Account check.** On connect, the plugin records `account_id` from `users/get_current_account` with the Connection. A login to a different account is refused, and switching accounts means disconnect, then connect again with a First sync.
- **Disconnect** calls `auth/token/revoke`, then clears the device's secret, Sync snapshot, Base and Remote binding. It leaves vault files and the Remote untouched.
- **Remote root.** Each Remote is a subfolder of the App Folder. Connect lists subfolders, marks those with a Metadata folder as existing Remotes, and offers to create one named after the vault.
- **Change feed.** Recursive `list_folder` returns the listing and a cursor, and `list_folder/continue` is the `changes` Capability. A cursor reset (409) maps to `cursorLost`.
- **Conditional writes** are upload `mode=update` with the known `rev`, and `delete_v2` with `parent_rev`, files only. What `delete_v2` returns on a `parent_rev` mismatch must be confirmed and mapped to `preconditionFailed`.
- **`Dropbox-API-Arg`** escapes non-ASCII and 0x7F as `\uXXXX`, the same escaping as the official JS SDK; verified on Android and iOS.
- **Transfers.** Uploads use upload sessions in chunks under the per-request limit. Downloads use `Range` in parts under the same limit; `Range` returns `206` on both mobile platforms.
- **Name rules.** Dropbox paths are case-insensitive, so case-only collisions are skipped and reported.

### Status, notices, guidance

- **Entry points:**
  - desktop: a status bar item with a state dot, the state, and conflict and skipped counts;
  - mobile: a ribbon icon, because custom status bar items are not supported on Obsidian mobile;
  - everywhere: "Sync: …" commands.

  Whether the ribbon icon can reflect the state is left to implementation.
- **Sync window:** the state and a "Sync now" or "Reconnect" button, with tabs:
  - Conflicts: Conflict blocks, Conflict copies, configuration conflicts with "Restore local";
  - Skipped: each file with its reason;
  - Activity: the last N events in plain words, with "Copy for a bug report".
- **Modal prompts:** the Deletion guard, the First sync preview, "another device's First sync is in progress" (wait or continue), and onboarding.
- **Notices:** restored after delete, renamed to the Remote name, settings updated so a restart is needed, Conflict copy created, reconnect needed. Each also goes to the Activity log.
- **An `auth` error** pauses sync on that device only, with one notice and a persistent "Reconnect needed" state. The Sync snapshot, Base and settings are kept, so a reconnect to the same account continues with a normal sync.
- **Onboarding,** shown once per new Connection and reopenable from help, lists four practices:
  - set up one device first;
  - connect new devices with an empty or current vault;
  - wait for "Synced" before closing or going offline;
  - after being offline, sync before editing notes changed elsewhere.
- **Help** in settings and the Sync window repeats those and explains conflicts, edits outside the plugin, configuration categories and skipped files.
- **Language.** All UI strings are in English and Russian, chosen by Obsidian's language.

## Testing Decisions

- **What a good test is.** Tests exercise external behaviour through the three seams below, never internal helpers or call order. A good test sets up devices, vaults and a Remote, performs user-visible actions (edit, delete, rename, go offline, sync), and asserts on resulting files, prompts and notices. Tests use Vitest.
- **Seam 1: the sync engine through its ports.**
  - **Setup.** The engine runs against an in-memory FakeProvider and an in-memory FakeVault, a fake device store and secret store, a controllable clock, and a scripted UI port.
  - **FakeProvider controls:**
    - toggles for each Capability (conditional write on or off, change feed, file move, folder move);
    - configurable name rules and maximum size;
    - fault injection: `throttled`, `transient`, `cursorLost`, `preconditionFailed` from a concurrent writer, and a crash between any two steps.
  - **Multi-device scenarios** run several engine instances against one shared FakeProvider Remote. They cover:
    - clean merge and Conflict blocks, with device-name labels;
    - JSON and binary Conflict copies;
    - the 2-way merge with no Base;
    - concurrent writes with `preconditionFailed`;
    - folder delete racing an add;
    - delete versus edit;
    - every rename combination;
    - the Deletion guard thresholds;
    - First sync union, the bulk option, identical-file detection, and simultaneous initialisation of an empty Remote;
    - interrupted syncs resuming;
    - shared-settings collisions;
    - configuration categories, including per-device switching and configuration conflicts;
    - ignore list, size ceiling, the name policy in both modes, and case collisions;
    - refusing a provider without conditional writes;
    - `auth` pause and reconnect.
- **Seam 2: the Provider contract suite.** One suite of contract tests runs against both the FakeProvider and the Dropbox provider. For Dropbox, Obsidian's `requestUrl` is mocked with recorded or hand-written Dropbox HTTP responses. The suite checks:
  - listing and the change feed, including cursor reset → `cursorLost`;
  - conditional write and delete, including `preconditionFailed`;
  - upload sessions and `Range` downloads that keep each request under the per-request limit;
  - `Dropbox-API-Arg` escaping of non-ASCII paths;
  - error mapping to the ten categories;
  - the PKCE code exchange and refresh;
  - account check and revoke.

  A later provider must pass the same suite.
- **Seam 3: the Conflict-block module.** Pure-function tests from document text to blocks and to the result of each action: keep this, keep other, keep both, hand edit. They include nested and malformed markers.
- **Manual checks on devices.** The UI and platform behaviour are checked by hand on desktop, Android and iOS:
  - status bar or ribbon entry, Sync window, modals, notices;
  - 44 px touch targets;
  - reading view;
  - onboarding in both languages;
  - large attachments up to the ceiling;
  - background, offline and return triggers.
- **Prior art.** The codebase has no tests yet. The throwaway probe plugin on branch `prototype/mobile-runtime-checks` shows how the platform facts were measured, and the Vitest skill shows how to mock `requestUrl` from `obsidian`.

## Out of Scope

- Device journals and providers without conditional writes (Google Drive, some WebDAV servers): designed in ADR 0003, but not built in this release.
- Any provider other than Dropbox, and choosing a provider in the UI.
- Real-time collaborative editing.
- Background sync while Obsidian is closed or suspended.
- End-to-end encryption.
- Syncing one vault to several Remotes at once.
- One vault shared by several people.
- Selective sync (per-device exclusions).

## Further Notes

- **Left to implementation, with no decision pending:**
  - defaults for the post-edit pause, the polling interval, the Deletion guard N and P, the activity log length, the per-request chunk size (under 20 MB), and the "First sync in progress" mark timeout;
  - the inactive-device threshold;
  - the fixed Remote name for the configuration folder and the Metadata folder name;
  - the reversible name encoding;
  - the default text-extension list;
  - the merge library;
  - how remote changes are written into an open editor without moving the cursor.
- **Release checklist:**
  - Obsidian community plugin rules: only `main.js`, `manifest.json` and `styles.css` are installed; no telemetry; the README discloses network use and the Dropbox account requirement; prefer `requestUrl`.
  - Dropbox production review: once 50 users link the app, approval must come within two weeks or new links freeze.
  - The Dropbox app name may not contain "Dropbox", cannot change after production status, and names the user's `Apps/` folder.
- **Testing strategy:** the seams above, plus manual multi-device checks.
- **State format.** The plugin's own state (Sync snapshot, Base, device record, Metadata folder files) carries a format version. An unknown version on a device triggers a First sync for that device. Rules for migrating Metadata folder formats are left to implementation.
- **Risks to verify during implementation:**
  - how Obsidian reacts to configuration files changing on disk while it runs;
  - whether the ribbon icon can change at runtime;
  - the `delete_v2` `parent_rev` mismatch error;
  - what happens to a Connection when the user renames or deletes the App Folder;
  - whether a password change revokes refresh tokens;
  - whether the `Apps` folder name is localised.
- **Installing on iOS for testing.** Hidden folders are not reachable there. Templater JavaScript execution commands work on iOS and were used to install the probe plugin.
