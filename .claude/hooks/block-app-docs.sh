#!/bin/sh
# Claude Code PreToolUse hook for Write, Edit, and MultiEdit.
#
# Rule: each app repository holds one README.md at its root and no
# other documentation. AGENTS.md at the app root is the only other
# markdown file allowed. No CLAUDE.md anywhere, because it would stop
# Claude Code from reading AGENTS.md.
#
# Exit 0 lets the write happen. Exit 2 blocks it and sends the
# message on stderr back to the model.

path=$(sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -z "$path" ] && exit 0

case "$(basename "$path")" in
  CLAUDE.md|CLAUDE.local.md)
    cat >&2 <<MSG
Blocked: $path
This workspace uses AGENTS.md only. A CLAUDE.md stops Claude Code from
reading the AGENTS.md files. Put the rule in the nearest AGENTS.md.
MSG
    exit 2 ;;
esac

# Only care about files inside an app folder.
case "$path" in
  */apps/*/*) ;;
  *) exit 0 ;;
esac

# Strip everything up to and including the app folder name.
inside=$(printf '%s' "$path" | sed 's|.*/apps/[^/]*/||')

# Allowed root files.
case "$inside" in
  README.md|AGENTS.md) exit 0 ;;
esac

# Ignore dependency and output folders.
case "$inside" in
  node_modules/*|.git/*|coverage/*) exit 0 ;;
esac

blocked=0
case "$inside" in
  *.md|*.mdx|*.rst|*.adoc) blocked=1 ;;
  docs/*|doc/*|*/docs/*|*/doc/*) blocked=1 ;;
esac

[ "$blocked" -eq 0 ] && exit 0

cat >&2 <<MSG
Blocked: $path
App repositories hold one README.md at the root and no other documentation.
Do not add markdown files, a docs folder, a CHANGELOG, or design notes inside an app.
Shared documentation goes in the workspace docs/ folder.
MSG
exit 2
