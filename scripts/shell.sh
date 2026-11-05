#!/bin/bash
# Usage: scripts/shell.sh lint|format [file.sh...]
#
# Checks or formats the project's shell scripts with shellcheck and shfmt.
#   lint    shellcheck, then shfmt in diff mode; fails if either finds
#           something. Changes nothing.
#   format  shfmt in write mode (shellcheck has nothing to rewrite).
# With file arguments (the staged files, from the pre-commit hook) it takes
# only those; with none, every tracked *.sh. Either way, the paths excluded
# below are skipped, so the pathspecs here are the one list of what is out of
# scope: the devcontainer template's files, vendored agent skills, and Claude
# Code's own files, as in .prettierignore. shfmt reads its style (two-space
# indent) from .editorconfig.
set -euo pipefail

mode=${1:-}
shift || true
case $mode in
lint | format) ;;
*)
  echo "usage: $0 lint|format [file.sh...]" >&2
  exit 2
  ;;
esac

toplevel=$(git rev-parse --show-toplevel)
cd "$toplevel"

# git ls-files, not find: it lists the tracked files only, never
# node_modules/, dist/ or other ignored output, and `*.sh` matches at any depth.
# Given files are taken by their exact names (:(literal)), so a staged
# a[1].sh is not read as a glob.
pathspecs=("*.sh")
if [[ $# -gt 0 ]]; then
  pathspecs=("${@/#/:(literal)}")
fi
files=()
mapfile -d '' -t files < <(git ls-files -z -- "${pathspecs[@]}" \
  ':(exclude).devcontainer' ':(exclude).config/mise/conf.d' \
  ':(exclude).agents/skills' ':(exclude).claude' ':(exclude).scratch')
wait $! # git ls-files' status, which < <(...) does not check
[[ ${#files[@]} -gt 0 ]] || exit 0

if [[ $mode == format ]]; then
  shfmt -w "${files[@]}"
else
  status=0
  shellcheck "${files[@]}" || status=1
  shfmt -d "${files[@]}" || status=1
  exit "$status"
fi
