#!/bin/sh
# Usage: settings.sh <dir>
#
# Runs on the host from initializeCommand (claude/devcontainer.json) and
# writes the keys of the host user's ~/.claude/settings.json that reach the
# container, and nothing else of it, to <dir>/claude/host-settings.json,
# which the image links
# /etc/claude-code/managed-settings.d/host-settings.json to:
# - hooks, the global Claude Code hooks, as they are
#   (docs/specs/devcontainer-claude-skills-hooks.md);
# - enabledPlugins, the plugins the host enables, whose files plugins.sh
#   copies (docs/specs/devcontainer-claude-plugins.md). Its entries as
#   they are (true, or the extended form with version constraints), but
#   not those that are false or null: in managed settings false blocks a
#   plugin at every level, where on the host a project's settings can
#   still enable it.
#
# A host without settings.json or without these keys is not an error: the
# file is {}. jq is needed only when settings.json exists; settings that
# are not one JSON object (an empty file and a dangling symlink included),
# an enabledPlugins that is not an object, or a missing jq, fail
# `devcontainer up` and keep the old file, rather than silently dropping
# the hooks and the plugins.
#
# From the devcontainer template (github.com/kravlad/devcontainer-template),
# which owns this file: `mise run dc-template-update` updates it and merges
# local edits.
# The specs named here are in its docs/specs/.
set -eu

dir=$1
src=$HOME/.claude/settings.json
dest=$dir/claude

mkdir -p "$dest"
# Written to a temporary file and renamed over the old one, so a reader
# never sees a half-written file and what was removed on the host
# disappears.
tmp=$(mktemp "$dest/.host-settings.json.XXXXXX")
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' INT TERM
# -L: a dangling symlink is settings jq cannot read, not a host without
# settings.
if [ -e "$src" ] || [ -L "$src" ]; then
	# -s counts the values: without it jq prints nothing for an empty
	# file and one object per value for several, and the output would not
	# be valid JSON. The types are checked because has accepts null and
	# with_entries an array.
	jq -s '
		if length == 1 then .[0] else error("expected one JSON value, found \(length)") end
		| if type == "object" then . else error("expected a JSON object, found \(type)") end
		| (if has("hooks") then {hooks} else {} end)
			+ (.enabledPlugins // {}
				| if type == "object" then . else error("expected enabledPlugins to be an object, found \(type)") end
				| with_entries(select(.value != false and .value != null))
				| if length > 0 then {enabledPlugins: .} else {} end)
	' "$src" >"$tmp"
else
	echo '{}' >"$tmp"
fi
# mktemp creates the file 0600; it must be readable through rootless
# Podman's user namespace.
chmod 0644 "$tmp"
mv "$tmp" "$dest/host-settings.json"
