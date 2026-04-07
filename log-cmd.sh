#!/bin/sh
# ForceCommand wrapper — structured JSON audit logging.
#
# Appends JSON lines to /var/log/docs-ssh.jsonl. The entrypoint tails
# this file to stderr so Docker/Dockge captures it.
# stdout/stderr from the actual command flow directly to the SSH client.

LOG_FILE="/var/log/docs-ssh.jsonl"
CLIENT="${SSH_CLIENT%% *}"

log_json() {
  printf '%s\n' "$1" >> "$LOG_FILE" 2>/dev/null
}

# Interactive shell
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"interactive\",\"client\":\"$CLIENT\"}"
  exec /bin/bash -l
fi

# Escape command for JSON: backslashes, quotes, newlines, tabs
LOG_CMD="$(printf '%.1024s' "$SSH_ORIGINAL_COMMAND" | \
  sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' | \
  tr '\n' ' ')"

# Log start
log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"exec\",\"client\":\"$CLIENT\",\"cmd\":\"$LOG_CMD\"}"

# Run command — stdout/stderr go directly to SSH client
START_S=$(date +%s)
/bin/bash -c "$SSH_ORIGINAL_COMMAND"
EXIT_CODE=$?
DUR=$(( $(date +%s) - START_S ))

# Log completion
log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"exec.done\",\"client\":\"$CLIENT\",\"cmd\":\"$LOG_CMD\",\"exit\":$EXIT_CODE,\"dur_s\":$DUR}"

exit "$EXIT_CODE"
