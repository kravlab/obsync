# Functions of the host scripts that copy a directory of the host's
# ~/.claude for the container (skills.sh, plugins.sh). Read with `.` from
# the script's own directory, not run; needs `set -eu` in the reader
# (docs/specs/devcontainer-claude-skills-hooks.md).
#
# A copy is staged in a temporary directory and then published in one
# step, so a script that fails keeps the old copy, and what was removed
# on the host disappears from the new one.
#
# From the devcontainer template (github.com/kravlad/devcontainer-template),
# which owns this file: `mise run dc-template-update` updates it and merges
# local edits.
# The specs named here are in its docs/specs/.

# stage_copy <parent> <name>
#
# Creates <parent> and an empty temporary directory in it, named by
# $staged, for the caller to fill and publish_copy to put at
# <parent>/<name>. A script that ends before that removes it.
stage_copy() {
	copy_parent=$1
	copy_name=$2
	mkdir -p "$copy_parent"
	staged=$(mktemp -d "$copy_parent/.$copy_name.XXXXXX")
	replaced=$staged.old
	trap unstage_copy EXIT
	trap 'exit 1' INT TERM
}

# Runs when the script ends. Stopped between the two renames of
# publish_copy, the old copy goes back in place.
unstage_copy() {
	if [ -d "$replaced" ] && [ ! -e "$copy_parent/$copy_name" ]; then
		mv "$replaced" "$copy_parent/$copy_name"
	fi
	# After publish_copy there is nothing left to remove. After a copy that
	# failed half-way there is, and cp kept the mode of a read-only
	# directory, which rm could not empty: the temporary directory would
	# stay, in memory and in the container's mount, after every such run.
	if [ -d "$staged" ]; then
		chmod -R u+w "$staged"
		rm -rf "$staged"
	fi
}

# publish_copy
#
# Replaces <parent>/<name> of stage_copy with $staged.
publish_copy() {
	# mktemp creates the directory 0700 and what was copied may be private
	# on the host; the copy must be readable through rootless Podman's user
	# namespace. u+w: cp keeps the mode of a read-only directory, which the
	# next run could not remove.
	chmod -R u+w,a+rX "$staged"
	# rename cannot replace a non-empty directory, so the old copy is moved
	# aside first: the directory is missing for a moment, and what was
	# removed on the host disappears.
	if [ -d "$copy_parent/$copy_name" ]; then
		mv "$copy_parent/$copy_name" "$replaced"
	fi
	mv "$staged" "$copy_parent/$copy_name"
	rm -rf "$replaced"
}
