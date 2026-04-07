#!/bin/sh
# ForceCommand wrapper — routes built-in commands and logs all exec.
#
# Built-in commands: help, sources, agents, tools, setup
# Everything else: executed via bash with audit logging.

LOG_FILE="/var/log/docs-ssh.jsonl"
CLIENT="${SSH_CLIENT%% *}"
CMD_DIR="/usr/local/lib/docs-ssh"

log_json() {
  printf '%s\n' "$1" >> "$LOG_FILE" 2>/dev/null
}

# Interactive shell — show help on connect
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"interactive\",\"client\":\"$CLIENT\"}"
  sh "$CMD_DIR/help.sh"
  exec /bin/bash -l
fi

# Check for built-in commands (first word of the command)
FIRST_WORD="${SSH_ORIGINAL_COMMAND%% *}"
case "$FIRST_WORD" in
  help|sources|agents|tools|setup)
    log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"builtin\",\"client\":\"$CLIENT\",\"cmd\":\"$FIRST_WORD\"}"
    exec sh "$CMD_DIR/${FIRST_WORD}.sh"
    ;;
esac

# Regular command — log and execute
LOG_CMD="$(printf '%.1024s' "$SSH_ORIGINAL_COMMAND" | \
  sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | \
  tr '\n' ' ')"

log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"exec\",\"client\":\"$CLIENT\",\"cmd\":\"$LOG_CMD\"}"

START_S=$(date +%s)
/bin/bash -c "$SSH_ORIGINAL_COMMAND"
EXIT_CODE=$?
DUR=$(( $(date +%s) - START_S ))

log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"exec.done\",\"client\":\"$CLIENT\",\"cmd\":\"$LOG_CMD\",\"exit\":$EXIT_CODE,\"dur_s\":$DUR}"

exit "$EXIT_CODE"
