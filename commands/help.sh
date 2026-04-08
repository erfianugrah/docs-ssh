#!/bin/sh
# Dynamic help — uses env vars so HOST and PORT are correct in production.
# Sources lib/colors.sh for TTY-aware coloring (FORCE_COLOR=1 for exec mode).

LIB_DIR="$(dirname "$0")/lib"
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

printf '  %sDocumentation over SSH for AI coding agents%s\n\n' "${C_MUTED}" "${C_RESET}"

# ─── Usage ──────────────────────────────────────────────────────────

printf '%s%sUsage%s\n' "${C_BOLD}" "${C_BLUE}" "${C_RESET}"
printf '  ssh %s-p %s%s docs@%s %s<command>%s\n\n' \
  "${C_CYAN}" "$PORT" "${C_RESET}" "$HOST" "${C_DIM}" "${C_RESET}"

# ─── Built-in commands ──────────────────────────────────────────────

printf '%s%sBuilt-in commands%s\n' "${C_BOLD}" "${C_BLUE}" "${C_RESET}"
printf '  %shelp%s             %sShow this help%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %ssources%s          %sList available doc sets and file counts%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sagents%s           %sAGENTS.md snippet (raw SSH patterns)%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sagents opencode%s  %sOpenCode format (custom docs_* tools)%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sagents claude%s    %sCLAUDE.md format%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sagents skill%s     %sSKILL.md with YAML frontmatter%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sagents help%s      %sShow all output formats%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %stools%s            %sOpenCode custom tools (rg --json, bat)%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %ssetup%s            %sInteractive setup guide%s\n\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"

# ─── Search & read ──────────────────────────────────────────────────

printf '%s%sSearch & read%s\n' "${C_BOLD}" "${C_BLUE}" "${C_RESET}"
printf '  %srg%s %s'\''pattern'\''%s /docs/supabase/       %sripgrep (fast, regex)%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %srg --json%s %s'\''auth'\''%s /docs/supabase/   %sstructured JSON output%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sgrep -rl%s %s'\''query'\''%s /docs/            %ssearch all docs%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sbat%s /docs/postgres/indexes.md       %sread with line numbers%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %scat%s /docs/supabase/guides/auth.md   %sread a file%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %sfind%s /docs/vercel -name %s'\''*.md'\''%s     %sfind by pattern%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %stree%s /docs/aws/ -L 2                %sdirectory structure%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"
printf '  %shead%s -20 /docs/postgres/indexes.md  %sskim a file%s\n\n' \
  "${C_GREEN}" "${C_RESET}" "${C_MUTED}" "${C_RESET}"

# ─── Examples ───────────────────────────────────────────────────────

printf '%s%sExamples%s\n' "${C_BOLD}" "${C_BLUE}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %sagents >> AGENTS.md%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %sagents opencode > ~/.config/opencode/AGENTS.md%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %stools > .opencode/tools/docs.ts%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %ssetup | opencode%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_DIM}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %s"rg -i '\''RLS'\'' /docs/supabase/"%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}"
printf '  %s$%s ssh docs.erfi.io %s"tree /docs/cloudflare/ -L 2"%s\n' \
  "${C_GREEN}" "${C_RESET}" "${C_CYAN}" "${C_RESET}"
