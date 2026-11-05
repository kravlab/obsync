#!/bin/bash
# Usage: scripts/hooks/gitleaks-pushed.sh <remote> < <pre-push stdin>
#
# The pre-push hook's secret scan: runs gitleaks over the commits that are
# about to be pushed, and over those only. git hands the hook, one line per
# ref being pushed, "<local ref> <local oid> <remote ref> <remote oid>" on
# stdin, and the remote's name as $1; for each ref this scans
#   - an existing remote branch: the commits from the remote's oid to the
#     local one, or, when this clone lacks the remote's oid (the remote
#     moved on), the commits no branch of the remote has;
#   - a new branch (remote oid all zeros): the commits no branch of the
#     remote has yet;
#   - a deletion (local oid all zeros): nothing, as nothing is pushed.
# Run by hand (`lefthook run pre-push < /dev/null`), stdin has no lines, so
# it scans the commits no branch of the remote has: the same as pushing every
# local branch.
set -euo pipefail

# Which remote-tracking branches count as already pushed: the named
# remote's, or every remote's when there is no name: a run by hand, or a
# push to a URL, which git passes in place of a name.
remote=${1:-}
if [[ -n $remote ]] && git remote | grep -qFx -- "$remote"; then
  remotes=--remotes=$remote
else
  remotes=--remotes
fi
# Scans one range of commits (git log arguments); gitleaks fails on a leak.
scan() {
  gitleaks git --no-banner --redact --verbose --log-opts="$1"
}

lines=0
while read -r _ local_oid _ remote_oid; do
  lines=$((lines + 1))
  [[ $local_oid =~ ^0+$ ]] && continue
  if [[ $remote_oid =~ ^0+$ ]] || ! git cat-file -e "$remote_oid^{commit}" 2>/dev/null; then
    scan "$local_oid --not $remotes"
  else
    scan "$remote_oid..$local_oid"
  fi
done

if [[ $lines -eq 0 ]]; then
  scan "--branches --not $remotes"
fi
