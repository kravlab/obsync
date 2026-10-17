# Vault Sync

An Obsidian plugin that keeps one person's vault consistent across their devices through a cloud storage service.

## Language

**Vault**:
The user's Obsidian folder of notes and attachments, as it exists on one device.
_Avoid_: Local folder, workspace

**Device**:
One installation of Obsidian (desktop or mobile) holding its own copy of the vault.
_Avoid_: Client, machine, instance

**Provider**:
An adapter to one specific cloud storage service that the plugin syncs through; Google Drive is the first.
_Avoid_: Backend, storage, cloud, Drive (as a generic term)

**Remote**:
The copy of the vault held by a provider, shared by all of the user's devices.
_Avoid_: Drive, cloud copy, server
