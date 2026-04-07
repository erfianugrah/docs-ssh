#!/bin/sh
# ForceCommand wrapper — routes built-in commands and logs all exec.
# Uses jq for safe JSON encoding (no shell injection in log output).
#
# Built-in commands: help, sources, agents, tools, setup
# Everything else: executed via bash with audit logging.

# Recover container env vars (sshd drops them for the docs user session)
[ -f /run/sshd/docs-ssh.env ] && . /run/sshd/docs-ssh.env
export DOCS_SSH_HOST DOCS_SSH_PORT

LOG_FILE="/var/log/docs-ssh.jsonl"
CMD_DIR="/usr/local/lib/docs-ssh"
CLIENT="${SSH_CLIENT%% *}"

log_json() {
  # Use jq for proper JSON encoding — immune to injection via command strings
  jq -nc --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
         --arg type "$1" \
         --arg client "$CLIENT" \
         --arg cmd "${2:-}" \
         --argjson exit "${3:-0}" \
         --argjson dur "${4:-0}" \
         '{ts: $ts, type: $type, client: $client, cmd: $cmd, exit: $exit, dur_s: $dur}' \
    >> "$LOG_FILE" 2>/dev/null
}

# Interactive shell — show help on connect
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  log_json "interactive"
  sh "$CMD_DIR/help.sh"
  exec /bin/bash -l
fi

# Check for built-in commands (first word only, no args)
FIRST_WORD="${SSH_ORIGINAL_COMMAND%% *}"
case "$FIRST_WORD" in
  help|sources|agents|tools|setup)
    log_json "builtin" "$FIRST_WORD"
    exec sh "$CMD_DIR/${FIRST_WORD}.sh"
    ;;
esac

# Regular command — log and execute
log_json "exec" "$SSH_ORIGINAL_COMMAND"

START_S=$(date +%s)
/bin/bash -c "$SSH_ORIGINAL_COMMAND"
EXIT_CODE=$?
DUR=$(( $(date +%s) - START_S ))

log_json "exec.done" "$SSH_ORIGINAL_COMMAND" "$EXIT_CODE" "$DUR"

exit "$EXIT_CODE"
