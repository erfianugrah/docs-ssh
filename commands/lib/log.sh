#!/bin/sh
# JSONL audit logging.
# Source this file - it exports docsop_split() and log_json().
#
# Requires: jq, base64, LOG_FILE, CLIENT (set by log-cmd.sh before sourcing).
# Optional: LOG_MAX_BYTES (default 50 MB) - appends stop at that size; the
# entrypoint rotates the file on each container start.
#
# Log format (one JSON object per line):
#   {"ts":"...","type":"...","client":"...","cmd":"...","exit":0,"dur_s":0,"cached":false}
# plus op/q/path/source/pattern/direction/sid when the client sent a marker.
#
# Types:
#   interactive - user opened an interactive shell (no command)
#   builtin     - ran a built-in command (help, sources, agents, tools, setup)
#   exec        - started executing a regular command
#   exec.done   - finished executing a regular command (has exit code + duration)

# Clients (docs-core.ts) prefix commands with `: docsop <base64 json>; ` so
# the log records the docs operation instead of only its shell pipeline.
# Sets DOCS_CMD (command without the marker) and DOCS_META (base64, or empty
# when absent or not plain base64).
docsop_split() {
  DOCS_CMD="$1"
  DOCS_META=""
  case "$1" in
    ": docsop "*)
      _rest="${1#: docsop }"
      _meta="${_rest%%;*}"
      DOCS_CMD="${_rest#*;}"
      DOCS_CMD="${DOCS_CMD# }"
      case "$_meta" in
        *[!A-Za-z0-9+/=]*|"") ;;
        *) [ "${#_meta}" -le 4096 ] && DOCS_META="$_meta" ;;
      esac
      ;;
  esac
}

log_json() {
  # The container healthcheck runs `echo ok` every 30s; it is not traffic.
  case "$CLIENT" in
    127.0.0.1|::1) [ "${2:-}" = "echo ok" ] && return 0 ;;
  esac
  if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0)" -ge "${LOG_MAX_BYTES:-52428800}" ]; then
    return 0
  fi
  _meta_json='{}'
  if [ -n "${DOCS_META:-}" ]; then
    _meta_json=$(printf '%s' "$DOCS_META" | base64 -d 2>/dev/null |
      jq -c 'if type == "object" then {op, q, path, source, pattern, direction, sid}
               | with_entries(select(.value != null) | .value |= (tostring | .[0:500]))
             else {} end' 2>/dev/null) || _meta_json='{}'
    [ -n "$_meta_json" ] || _meta_json='{}'
  fi
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg type "$1" \
    --arg client "$CLIENT" \
    --arg cmd "${2:-}" \
    --argjson exit "${3:-0}" \
    --argjson dur "${4:-0}" \
    --argjson cached "${5:-false}" \
    --argjson meta "$_meta_json" \
    '{ts:$ts, type:$type, client:$client, cmd:$cmd, exit:$exit, dur_s:$dur, cached:$cached} + $meta' \
    >> "$LOG_FILE" 2>/dev/null
}
