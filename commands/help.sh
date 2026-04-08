#!/bin/sh
# Dynamic help — uses env vars so HOST and PORT are correct in production.
# Sources lib/colors.sh for TTY-aware coloring.

LIB_DIR="$(dirname "$0")/lib"
. "$LIB_DIR/colors.sh"

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

# ─── Header ─────────────────────────────────────────────────────────

printf '%s%sdocs-ssh%s — documentation over SSH for AI agents\n\n' \
  "${C_PURPLE}" "${C_BOLD}" "${C_RESET}"

# ─── Usage ──────────────────────────────────────────────────────────

printf '%sUsage:%s\n' "${C_BOLD}" "${C_RESET}"
printf '  ssh %s-p %s%s docs@%s %s<command>%s\n\n' \
  "${C_BLUE}" "$PORT" "${C_RESET}" "$HOST" "${C_DIM}" "${C_RESET}"

# ─── Built-in commands ──────────────────────────────────────────────

printf '%sBuilt-in commands:%s\n' "${C_BOLD}" "${C_RESET}"
printf '  %shelp%s          Show this help\n' "${C_GREEN}" "${C_RESET}"
printf '  %ssources%s       List available doc sets and file counts\n' "${C_GREEN}" "${C_RESET}"
printf '  %sagents%s        Output agent instructions (agents claude|cursor|gemini|skill|help)\n' "${C_GREEN}" "${C_RESET}"
printf '  %stools%s         Output OpenCode custom tools file (save as .opencode/tools/docs.ts)\n' "${C_GREEN}" "${C_RESET}"
printf '  %ssetup%s         Interactive setup guide (pipe to your agent: ssh ... setup | opencode)\n\n' "${C_GREEN}" "${C_RESET}"

# ─── Search & read ──────────────────────────────────────────────────

printf '%sSearch & read:%s\n' "${C_BOLD}" "${C_RESET}"
printf '  grep -rl %s'\''query'\''%s /docs/          %sSearch across all docs%s\n' \
  "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  rg %s'\''pattern'\''%s /docs/supabase/     %sFast regex search with ripgrep%s\n' \
  "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  cat /docs/supabase/guides/auth.md  %sRead a specific file%s\n' \
  "${C_MUTED}" "${C_RESET}"
printf '  bat /docs/postgres/indexes.md      %sRead with line numbers%s\n' \
  "${C_MUTED}" "${C_RESET}"
printf '  find /docs/vercel -name %s'\''*.md'\''%s   %sFind files by pattern%s\n' \
  "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  tree /docs/aws/ -L 2               %sBrowse directory structure%s\n' \
  "${C_MUTED}" "${C_RESET}"
printf '  head -20 /docs/postgres/indexes.md %sSkim a file%s\n\n' \
  "${C_MUTED}" "${C_RESET}"

# ─── Examples ───────────────────────────────────────────────────────

printf '%sExamples:%s\n' "${C_BOLD}" "${C_RESET}"
printf '  %s$%s ssh -p %s docs@%s agents %s>> AGENTS.md%s\n' \
  "${C_GREEN}" "${C_RESET}" "$PORT" "$HOST" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh -p %s docs@%s tools %s> .opencode/tools/docs.ts%s\n' \
  "${C_GREEN}" "${C_RESET}" "$PORT" "$HOST" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh -p %s docs@%s setup %s| opencode%s\n' \
  "${C_GREEN}" "${C_RESET}" "$PORT" "$HOST" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh -p %s docs@%s %s"grep -rl '\''RLS'\'' /docs/supabase/"%s\n' \
  "${C_GREEN}" "${C_RESET}" "$PORT" "$HOST" "${C_CYAN}" "${C_RESET}"
printf '  %s$%s ssh -p %s docs@%s %s"rg --json '\''auth'\'' /docs/supabase/"%s\n' \
  "${C_GREEN}" "${C_RESET}" "$PORT" "$HOST" "${C_CYAN}" "${C_RESET}"
