#!/usr/bin/env bash
# Fails when a tracked file holds a real-looking absolute home directory or an email address.
# Placeholders that are allowed: home directories named you, user, username, me, name, runner or example
# (and anything written as /Users/<you>); email addresses at example.com, .org or .net, at the reserved
# .example, .test, .invalid and .localhost domains, and GitHub's users.noreply.github.com.
# Usage: scripts/leak-check.sh [repo-dir]   (default: the current directory)
set -euo pipefail
cd "${1:-.}"

placeholder_home='^(you|user|username|me|name|runner|example)$'
placeholder_mail='@([A-Za-z0-9-]+\.)*(example\.(com|org|net)|[A-Za-z0-9-]+\.(example|test|invalid|localhost)|example|test|invalid|localhost|users\.noreply\.github\.com)$'

found=0

# Home directories: /Users/<name>, /home/<name>, C:\Users\<name>. A URL path such as host/home/topics is not one:
# the slash must not follow a letter, digit, dot or hyphen.
while IFS= read -r hit; do
  name=$(printf '%s\n' "$hit" | sed -E 's#.*(/Users/|/home/|[A-Za-z]:\\Users\\)([A-Za-z0-9._-]+).*#\2#')
  if ! [[ "$name" =~ $placeholder_home ]]; then
    printf 'home path: %s\n' "$hit"
    found=1
  fi
done < <(git grep -nIoE '(^|[^A-Za-z0-9._-])(/Users/|/home/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+' -- . || true)

while IFS= read -r hit; do
  addr=${hit#*:*:}
  if ! [[ "$addr" =~ $placeholder_mail ]]; then
    printf 'email address: %s\n' "$hit"
    found=1
  fi
done < <(git grep -nIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' -- . || true)

if [ "$found" -ne 0 ]; then
  echo "leak check: failed. Replace each hit with a placeholder (/Users/you, someone@example.com)." >&2
  exit 1
fi
echo "leak check: no home paths or email addresses in tracked files"
