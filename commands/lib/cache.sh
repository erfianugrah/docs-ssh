#!/bin/sh
# Command result caching.
# Source this file — it exports should_cache, try_cache, exec_and_cache.
#
# Requires: CACHE_DIR (set by log-cmd.sh before sourcing).
#
# Docs are static for the container's lifetime, so identical read/search
# commands always produce the same result.  Stdout, stderr, and exit code
# are stored as separate files keyed by md5 of the command string.
#
# POSIX sh compatible — no bash process substitution (>(tee ...)).
#
# Limits:
#   - Commands with side effects (echo, touch, rm, ...) are never cached
#   - Results > 1 MB are not stored (prevents filling tmpfs)
#   - Cache lives in tmpfs — cleared on container restart

MAX_CACHE_BYTES=1048576  # 1 MB

# Returns 0 (true) if the command is safe to cache.
should_cache() {
  case "$1" in
    echo*|touch*|rm*|mv*|cp*|mkdir*|chmod*|tee*|bash*|sh*) return 1 ;;
    *) return 0 ;;
  esac
}

# Compute cache key from command string.
_cache_key() {
  printf '%s' "$1" | md5sum | cut -d' ' -f1
}

# Try to serve a cached result.  Returns 0 on hit, 1 on miss.
# On hit, writes stdout/stderr and sets CACHE_EXIT_CODE.
try_cache() {
  _key=$(_cache_key "$1")
  _base="$CACHE_DIR/$_key"
  [ -f "${_base}.out" ] || return 1
  cat "${_base}.out"
  [ -f "${_base}.err" ] && [ -s "${_base}.err" ] && cat "${_base}.err" >&2
  CACHE_EXIT_CODE=0
  [ -f "${_base}.rc" ] && CACHE_EXIT_CODE=$(cat "${_base}.rc")
  return 0
}

# Execute a command and cache the result.
# Captures stdout and stderr to temp files, then streams them to the
# client while also persisting for future cache hits.
# Uses only POSIX sh constructs (no bash process substitution).
exec_and_cache() {
  _key=$(_cache_key "$1")
  _base="$CACHE_DIR/$_key"

  # Run command, capture stdout and stderr to temp files.
  # We can't tee and stream simultaneously in POSIX sh without process
  # substitution, so we capture first then replay.  For docs queries
  # this adds negligible latency (output is typically <100KB).
  /bin/bash -c "$1" >"${_base}.out.tmp" 2>"${_base}.err.tmp"
  _exit=$?

  # Stream captured output to the client
  cat "${_base}.out.tmp"
  [ -s "${_base}.err.tmp" ] && cat "${_base}.err.tmp" >&2

  # Store exit code
  printf '%d' "$_exit" > "${_base}.rc.tmp"

  # Only persist if stdout is under the size limit
  _size=$(wc -c < "${_base}.out.tmp" 2>/dev/null || echo 0)
  if [ "$_size" -lt "$MAX_CACHE_BYTES" ]; then
    mv "${_base}.out.tmp" "${_base}.out" 2>/dev/null
    mv "${_base}.err.tmp" "${_base}.err" 2>/dev/null
    mv "${_base}.rc.tmp" "${_base}.rc" 2>/dev/null
  else
    rm -f "${_base}.out.tmp" "${_base}.err.tmp" "${_base}.rc.tmp"
  fi

  return $_exit
}
