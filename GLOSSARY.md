# Vault Sync

An Obsidian plugin that keeps one person's vault consistent across their devices through a cloud storage service.

## Language

**Vault**:
The user's Obsidian folder of notes and attachments, as it exists on one device.
_Avoid_: Local folder, workspace

**Vault path**:
A file's or folder's path relative to the vault root, as Obsidian names it.
_Avoid_: Local path, file path

**Device**:
One installation of Obsidian (desktop or mobile) holding its own copy of the vault, identified by a random Device ID and a user-editable device name.
_Avoid_: Client, machine, instance

**Provider**:
An adapter to one specific cloud storage service that the plugin syncs through.
_Avoid_: Backend, storage, cloud, Drive (as a generic term)

**Remote**:
The folder at a provider that holds a plain, human-readable mirror of exactly one vault, shared by all of the user's devices.
_Avoid_: Drive, cloud copy, server

**Remote path**:
The path of a vault entry relative to the Remote root after the Remote's name policy is applied; it equals the vault path unless a name had to be encoded.
_Avoid_: Cloud path, provider path, key (S3 term), id

**Capability**:
An optional ability a provider reports for a Remote after connecting (such as a change feed, conditional writes or server-side move); anything not reported is treated as absent.
_Avoid_: Feature, flag

**Connection**:
One device's authorised link to an account at a provider and to the Remote chosen there; it exists only on that device.
_Avoid_: Login, session, account link

**Metadata folder**:
The single plugin-owned folder at the root of a Remote; the only place on a Remote that holds anything other than vault files.
_Avoid_: Control folder, config folder, `.obsidian` (that is the vault's own configuration)

**Device journal**:
A device's own file in the Metadata folder, written only by that device, recording which Remote revisions it created on top of which earlier revisions and how far it has read the other devices' journals.
_Avoid_: Write log, lock, lease

**Base**:
The content a text file had at a device's last successful sync, kept by that device as the common ancestor for merging.
_Avoid_: Ancestor copy, cache, original

**Conflict block**:
A region of a text file, delimited by git-style markers labelled with this device's name and the other device's name, or "Remote" when that device is unknown, holding two versions that could not be merged automatically.
_Avoid_: Conflict markers (the markers delimit the block), diff

**Conflict copy**:
A sibling file next to the original, named after the device and time, that keeps a version which could not be merged into the original.
_Avoid_: Duplicate, backup, `.conflict` file

**First sync**:
A sync by a device that has no Sync snapshot for the Remote (a new device, a reinstall, or a lost snapshot); it only adds and merges, never deletes.
_Avoid_: Initial sync, onboarding, full sync

**Deletion guard**:
The stop a sync makes, asking the user to confirm, when it would delete more files than a set threshold on either side, or the whole vault or Remote root.
_Avoid_: Safety net, mass-delete protection

**Sync snapshot**:
A device's own record of how its vault and the Remote looked after its last successful sync; it never leaves the device.
_Avoid_: Sync state, manifest, index

**Per-request limit**:
The most file content a device lets a provider move in one request to or from its service; larger files move in parts. Each device sets its own.
_Avoid_: Chunk size, request size limit, part size

**Post-edit pause**:
The quiet time a device waits after the last edit before it syncs; the note being typed in is not written by a sync until it has passed.
_Avoid_: Typing pause, debounce, delay

**Polling interval**:
How often a device checks the Remote for changes while Obsidian is open.
_Avoid_: Refresh rate, poll period

**Change feed**:
A provider's report of what changed on the Remote since a point it marked, which a device reads instead of listing the whole Remote.
_Avoid_: Delta, change log, journal (a Device journal is something else)

**Full reconcile**:
A sync that lists the whole Remote instead of reading the change feed.
_Avoid_: Full sync, rescan

**Offline**:
The state of a device that cannot reach the Remote: it retries by itself, with growing waits, and shows no notices.
_Avoid_: Disconnected (that is "Not connected"), sync error
