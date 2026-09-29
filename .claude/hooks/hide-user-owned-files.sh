#!/bin/sh
# Claude Code PreToolUse hook for Read, Edit, Write, MultiEdit, NotebookEdit and Bash.
#
# Rule: the local config is owner-managed.
# Claude must not create, read, update or delete it, and must not name it in a shell command.
#
# Exit 0 lets the call happen. Exit 2 blocks it and sends the message on stderr back to the model.

input=$(cat)

path=$(printf '%s' "$input" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
command=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -n 1)

case "$path $command" in
  *config/local/config.yaml*)
    cat >&2 <<MSG
Blocked: the following file is owner-managed:
- config/local/config.yaml

Claude must not create, read, edit or delete this file, or name it in a command.
If it needs a change, ask the owner to make it.
MSG
    exit 2 ;;
esac

exit 0
