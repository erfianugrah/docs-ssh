#!/bin/sh
# Colored interactive banner — shown when a user opens an interactive SSH session.
# Sources lib/colors.sh for TTY-aware color variables.
#
# The banner includes:
#   - ASCII art logo in brand purple
#   - Quick-start code blocks with syntax-highlighted commands
#   - Contextual help pointing to setup/agents/tools

# Resolve lib path relative to this script
LIB_DIR="${LIB_DIR:-$(dirname "$0")/lib}"
. "$LIB_DIR/colors.sh"

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

# ─── Logo ───────────────────────────────────────────────────────────

printf '%s%s' "${C_PURPLE}" "${C_BOLD}"
cat << 'LOGO'
     _                          _
  __| | ___   ___ ___       ___| |__
 / _` |/ _ \ / __/ __|_____/ __| '_ \
| (_| | (_) | (__\__ \_____\__ \ | | |
 \__,_|\___/ \___|___/     |___/_| |_|
LOGO
printf '%s\n' "${C_RESET}"

# ─── Description ────────────────────────────────────────────────────

printf '\n%sDocumentation over SSH for AI coding agents.%s\n\n' "${C_MUTED}" "${C_RESET}"

printf 'Tell your agent to use %sssh -p %s docs@%s <command>%s to search the docs:\n\n' \
  "${C_DIM}" "$PORT" "$HOST" "${C_RESET}"

# ─── Setup block ────────────────────────────────────────────────────

printf '  %s# Setup using opencode%s\n' "${C_MUTED}" "${C_RESET}"
printf '  %s$%s ssh %s-p %s%s docs@%s setup %s|%s opencode\n\n' \
  "${C_GREEN}" "${C_RESET}" \
  "${C_BLUE}" "$PORT" "${C_RESET}" \
  "$HOST" \
  "${C_MUTED}" "${C_RESET}"

# ─── Agents block ──────────────────────────────────────────────────

printf '  %s# Or append directly to AGENTS.md%s\n' "${C_MUTED}" "${C_RESET}"
printf '  %s$%s ssh %s-p %s%s docs@%s agents %s>>%s AGENTS.md\n\n' \
  "${C_GREEN}" "${C_RESET}" \
  "${C_BLUE}" "$PORT" "${C_RESET}" \
  "$HOST" \
  "${C_MUTED}" "${C_RESET}"

# ─── Explore hint ──────────────────────────────────────────────────

printf 'Or explore them yourself with %stree%s/%sgrep%s/%scat%s/etc:\n\n' \
  "${C_CYAN}" "${C_RESET}" \
  "${C_CYAN}" "${C_RESET}" \
  "${C_CYAN}" "${C_RESET}"
