#!/bin/sh
# JSONL audit logging.
# Source this file — it exports log_json().
#
# Requires: jq, LOG_FILE, CLIENT (set by log-cmd.sh before sourcing).
#
# Log format (one JSON object per line):
#   {"ts":"...","type":"...","client":"...","cmd":"...","exit":0,"dur_s":0,"cached":false}
#
# Types:
#   interactive — user opened an interactive shell (no command)
#   builtin     — ran a built-in command (help, sources, agents, tools, setup)
#   exec        — started executing a regular command
#   exec.done   — finished executing a regular command (has exit code + duration)

log_json() {
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg type "$1" \
    --arg client "$CLIENT" \
    --arg cmd "${2:-}" \
    --argjson exit "${3:-0}" \
    --argjson dur "${4:-0}" \
    --argjson cached "${5:-false}" \
    '{ts:$ts, type:$type, client:$client, cmd:$cmd, exit:$exit, dur_s:$dur, cached:$cached}' \
    >> "$LOG_FILE" 2>/dev/null
}
