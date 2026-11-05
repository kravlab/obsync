#!/bin/bash
# Usage: scripts/tracked-files.sh <pathspec> <command> [args...]
#
# Runs <command> [args...] once, with every file git tracks that
# matches <pathspec> appended: the repository's files, not local ones
# git ignores (.gitignore, .git/info/exclude, the global excludes
# file), which Prettier and markdownlint-cli2 cannot tell apart on
# their own. Symbolic links (Prettier refuses one named on its command
# line) and tracked files deleted from the working tree are left out.
# Each tool still skips what its own ignore list names.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <pathspec> <command> [args...]" >&2
  exit 2
fi
pathspec=$1
shift

toplevel=$(git rev-parse --show-toplevel)
cd "$toplevel"

files=()
while IFS= read -r -d '' file; do
  [[ -f $file && ! -L $file ]] && files+=("$file")
done < <(git ls-files -z -- "$pathspec")
wait $! # git ls-files' status, which < <(...) does not check
[[ ${#files[@]} -gt 0 ]] || exit 0

exec "$@" "${files[@]}"
