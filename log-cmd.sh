#!/bin/sh
# ForceCommand router — the entry point for every SSH session.
#
# Responsibilities (and nothing else):
#   1. Recover env vars that sshd drops
#   2. Source shared libraries (colors, logging, caching)
#   3. Route to the correct handler: interactive / builtin / exec
#
# All heavy logic lives in commands/lib/ and commands/*.sh.

# ─── Environment ────────────────────────────────────────────────────

[ -f /run/sshd/docs-ssh.env ] && . /run/sshd/docs-ssh.env
export DOCS_SSH_HOST DOCS_SSH_PORT

LOG_FILE="/var/log/docs-ssh.jsonl"
CMD_DIR="/usr/local/lib/docs-ssh"
LIB_DIR="$CMD_DIR/lib"
CLIENT="${SSH_CLIENT%% *}"
CACHE_DIR="/tmp/docs-ssh-cache"

# ─── Libraries ──────────────────────────────────────────────────────

. "$LIB_DIR/colors.sh"
. "$LIB_DIR/log.sh"
. "$LIB_DIR/cache.sh"

# ─── Route: interactive shell ──────────────────────────────────────

if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  log_json "interactive"
  if [ "$USE_COLOR" = "1" ]; then
    LIB_DIR="$LIB_DIR" sh "$CMD_DIR/banner.sh"
    export PS1="${C_PURPLE}docs${C_RESET} ${C_DIM}\w${C_RESET} \$ "
  else
    sh "$CMD_DIR/help.sh"
  fi
  exec /bin/bash -l
fi

# ─── Route: built-in commands ──────────────────────────────────────

FIRST_WORD="${SSH_ORIGINAL_COMMAND%% *}"
case "$FIRST_WORD" in
  help|sources|agents|tools|setup)
    log_json "builtin" "$SSH_ORIGINAL_COMMAND"
    # Pass full command so builtins can parse their own arguments
    export SSH_ORIGINAL_COMMAND
    exec sh "$CMD_DIR/${FIRST_WORD}.sh"
    ;;
esac

# ─── Route: regular command (with caching) ─────────────────────────

if should_cache "$SSH_ORIGINAL_COMMAND" && try_cache "$SSH_ORIGINAL_COMMAND"; then
  log_json "exec" "$SSH_ORIGINAL_COMMAND" "$CACHE_EXIT_CODE" "0" "true"
  exit "$CACHE_EXIT_CODE"
fi

log_json "exec" "$SSH_ORIGINAL_COMMAND"
START_S=$(date +%s)

if should_cache "$SSH_ORIGINAL_COMMAND"; then
  exec_and_cache "$SSH_ORIGINAL_COMMAND"
  EXIT_CODE=$?
else
  /bin/bash -c "$SSH_ORIGINAL_COMMAND"
  EXIT_CODE=$?
fi

DUR=$(( $(date +%s) - START_S ))
log_json "exec.done" "$SSH_ORIGINAL_COMMAND" "$EXIT_CODE" "$DUR" "false"
exit "$EXIT_CODE"
