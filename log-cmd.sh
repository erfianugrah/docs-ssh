#!/bin/sh
# ForceCommand wrapper — structured JSON audit logging.
#
# Writes log lines to a named pipe that sshd's entrypoint tails to stderr,
# ensuring logs appear in Docker logs without needing /proc/1/fd/2 access.
# stdout/stderr from the actual command flow directly to the SSH client.

LOG_PIPE="/var/log/docs-ssh.pipe"
CLIENT="${SSH_CLIENT%% *}"

log_json() {
  # Write to named pipe if it exists, otherwise silently skip
  [ -p "$LOG_PIPE" ] && printf '%s\n' "$1" > "$LOG_PIPE" 2>/dev/null
}

# Interactive shell
if [ -z "$SSH_ORIGINAL_COMMAND" ]; then
  log_json "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"interactive\",\"client\":\"$CLIENT\"}"
  exec /bin/bash -l
fi

# Escape command for JSON: backslashes, quotes, newlines, tabs, control chars
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
