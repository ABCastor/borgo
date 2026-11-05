#!/usr/bin/env bash
# Builds the public repository from one ref: the ref's tracked files only (git archive), as a fresh repository with
# a single commit, then runs the leak check and the publish audit on it. Nothing is pushed.
#
# Usage: scripts/export-public.sh <ref> [scratch-dir]
#   ref          the commit, branch or tag to export (main, release-prep, v1.0.0)
#   scratch-dir  where the new repository goes; must not exist or be empty (default: a new temporary directory)
# Environment:
#   PUBLISH_AUDIT    the publish audit command, run as "$PUBLISH_AUDIT --all-refs <dir>" (default: publish-audit.sh on PATH)
#   EXPORT_NAME      commit author and committer name (default: Anneo22)
#   EXPORT_EMAIL     commit author and committer email (default: GitHub's noreply address for Anneo22)
#   EXPORT_ASSISTED  the Assisted-by trailer (default: Claude Opus 5.5)
set -euo pipefail

ref=${1:?usage: scripts/export-public.sh <ref> [scratch-dir]}
src=$(git rev-parse --show-toplevel)
out=${2:-$(mktemp -d)/borgo}
name=${EXPORT_NAME:-Anneo22}
email=${EXPORT_EMAIL:-159916923+Anneo22@users.noreply.github.com}
assisted=${EXPORT_ASSISTED:-Claude Opus 5.5}
audit=${PUBLISH_AUDIT:-$(command -v publish-audit.sh || true)}

git -C "$src" rev-parse --verify --quiet "$ref^{commit}" >/dev/null || { echo "export: no such ref: $ref" >&2; exit 1; }
if [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then echo "export: $out exists and is not empty" >&2; exit 1; fi
[ -n "$audit" ] || { echo "export: no publish audit found; set PUBLISH_AUDIT to its command" >&2; exit 1; }

mkdir -p "$out"
git -C "$src" archive --format=tar "$ref" | tar -x -C "$out"

git -C "$out" init -q -b main
git -C "$out" config user.name "$name"
git -C "$out" config user.email "$email"
git -C "$out" add -A
git -C "$out" commit -q -m "Borgo: first public release" -m "Assisted-by: $assisted"
echo "export: $(git -C "$out" rev-list --count HEAD) commit, $(git -C "$out" ls-files | wc -l | tr -d ' ') files from $ref ($(git -C "$src" rev-parse --short "$ref")) in $out"

bash "$out/scripts/leak-check.sh" "$out"
"$audit" --all-refs "$out"
