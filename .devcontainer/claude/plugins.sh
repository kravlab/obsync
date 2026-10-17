#!/bin/sh
# Usage: plugins.sh <dir>
#
# Runs on the host from initializeCommand (claude/devcontainer.json) and
# copies the host user's Claude Code plugins to <dir>/claude/plugins, the
# seed directory the image names in CLAUDE_CODE_PLUGIN_SEED_DIR: Claude
# Code loads the plugins from it in place and never writes to it
# (docs/specs/devcontainer-claude-plugins.md). Which of them are enabled
# is passed by settings.sh.
#
# Of ~/.claude/plugins only what makes a seed is copied: the record of
# the marketplaces, their catalogs and the plugins' cached files. Not the
# plugins' own data, the host's install records or the plugins of the
# signed-in account: the container keeps its own.
#
# A host without plugins is not an error: the copy is an empty directory.
# A plugin that cannot be copied (an unreadable file) fails
# `devcontainer up` and keeps the old copy, rather than silently dropping
# a plugin the user installed.
#
# From the devcontainer template (github.com/kravlad/devcontainer-template),
# which owns this file: `mise run dc-template-update` updates it and merges
# local edits.
# The specs named here are in its docs/specs/.
set -eu

dir=$1
src=$HOME/.claude/plugins

# stage_copy and publish_copy; $0 is this script's path.
. "$(dirname "$0")/lib.sh"

stage_copy "$dir/claude" plugins
# marketplaces is the larger part and still needed: without the catalogs
# Claude Code loads nothing from the seed.
for entry in known_marketplaces.json marketplaces cache; do
	# A host has only what it used: no plugins, not an error. -L keeps an
	# entry that is a dangling symlink for cp to fail on.
	[ -e "$src/$entry" ] || [ -L "$src/$entry" ] || continue
	if [ -d "$src/$entry" ]; then
		# /. names the directory also behind an entry that is a symlink (a
		# cache kept elsewhere), which would dangle in the container; cp -H
		# is the option for that, and uutils' cp fails with it on a link to
		# a directory. -P: the symlinks inside stay symlinks, unlike the
		# skills'. A link within a plugin (node_modules/.bin, files the
		# plugins of a marketplace share) must go on pointing into the
		# plugin, and a broken one in a marketplace, which the user did not
		# write, must not fail the copy.
		cp -RP "$src/$entry/." "$staged/$entry"
	else
		cp "$src/$entry" "$staged/"
	fi
done
publish_copy
