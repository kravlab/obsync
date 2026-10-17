#!/bin/sh
# Usage: skills.sh <dir>
#
# Runs on the host from initializeCommand (claude/devcontainer.json) and
# copies the host user's global Claude Code skills, the entries of
# ~/.claude/skills, to <dir>/claude/skills, which the image links
# /etc/claude-code/.claude/skills to
# (docs/specs/devcontainer-claude-skills-hooks.md).
#
# A host without skills is not an error: the copy is an empty directory.
# A skill that cannot be copied (a dangling symlink, an unreadable file)
# fails `devcontainer up` and keeps the old copy, rather than silently
# dropping a skill the user installed.
#
# From the devcontainer template (github.com/kravlad/devcontainer-template),
# which owns this file: `mise run dc-template-update` updates it and merges
# local edits.
# The specs named here are in its docs/specs/.
set -eu

dir=$1
src=$HOME/.claude/skills

# stage_copy and publish_copy; $0 is this script's path.
. "$(dirname "$0")/lib.sh"

stage_copy "$dir/claude" skills
for entry in "$src"/*; do
	# No source or an empty one leaves the pattern as written: no skills,
	# not an error. -L keeps a dangling symlink for cp to fail on.
	[ -e "$entry" ] || [ -L "$entry" ] || continue
	# synced is Claude Code's own copy of the account's skills; the
	# container syncs its own into its ~/.claude volume.
	case ${entry##*/} in
	synced) continue ;;
	esac
	# -L: the entries are usually symlinks out of ~/.claude, which would
	# dangle in the container; the copy holds what they point to.
	cp -RL "$entry" "$staged/"
done
publish_copy
