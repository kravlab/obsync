# 13: Configuration folder sync

Parent spec: `.scratch/vault-sync/spec.md`, "Synced file scope" (configuration folder).

**What to build:** Each device chooses which parts of its Obsidian configuration to sync. The categories are settings and hotkeys, themes and snippets, and plugins with their settings; all are off by default. Plugins comes with a warning that other plugins' settings may hold secrets. Devices with differently named configuration folders share one configuration. When settings arrive, the user is told to restart. On a configuration conflict the Remote version wins, and the local version can be restored from the conflict list.

**Blocked by:** 08 (Conflict copies for binary and JSON files), 12 (Synced file scope rules).

**Status:** ready-for-agent

- [ ] Category switches are per device. An off category is neither uploaded nor applied and stays out of that device's Sync snapshot. Turning a category on runs a First sync for its files.
- [ ] Workspace layout files and the sync plugin's own folder are never synced.
- [ ] The configuration is stored on the Remote under one fixed name and mapped to each device's `vault.configDir`.
- [ ] The configuration folder is scanned through the adapter on every poll, since it produces no vault events.
- [ ] Incoming configuration changes are written, and a "restart to apply" notice is shown. Other plugins are not reloaded.
- [ ] A configuration conflict that cannot merge into valid JSON keeps the Remote version in place and saves the local version in the plugin's folder, listed as restorable.
- [ ] Engine tests cover per-device categories, turning a category on, and a configuration conflict. A manual check covers how Obsidian reacts to configuration files changing on disk while it runs.
