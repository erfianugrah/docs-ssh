#!/bin/sh
# Brand colors and TTY detection.
# Source this file — it exports USE_COLOR and C_* variables.
#
# Colors match the CSS vars in public/index.html:
#   --purple: #c574dd   --green: #5adecd   --blue: #8796f4
#   --cyan: #79e6f3     --peach: #f1a171   --red: #f37e96
#   --surface: #282a36  --fg-muted: #bdbdc1
#
# Color modes:
#   - TTY detected (interactive sessions): always colored
#   - FORCE_COLOR=1 (set by log-cmd.sh for builtins like help/sources): colored
#     Builtins are for humans, not agents — agents use tools/agents commands.
#   - Neither (agent exec, piped output): plain text, zero overhead

if [ -t 1 ] || [ "${FORCE_COLOR:-0}" = "1" ]; then
  USE_COLOR=1
  # Use printf to generate real escape bytes (not literal \033 strings).
  # Storing via $(...) ensures the variable contains the actual ESC byte
  # which works correctly when passed through %s in subsequent printf calls.
  ESC=$(printf '\033')
  C_PURPLE="${ESC}[38;2;197;116;221m"
  C_GREEN="${ESC}[38;2;90;222;205m"
  C_BLUE="${ESC}[38;2;135;150;244m"
  C_CYAN="${ESC}[38;2;121;230;243m"
  C_PEACH="${ESC}[38;2;241;161;113m"
  C_RED="${ESC}[38;2;243;126;150m"
  C_DIM="${ESC}[2m"
  C_BOLD="${ESC}[1m"
  C_UNDERLINE="${ESC}[4m"
  C_RESET="${ESC}[0m"
  C_BG="${ESC}[48;2;40;42;54m"
  # Muted foreground — for secondary text, comments, separators
  C_MUTED="${ESC}[38;2;189;189;193m"
else
  USE_COLOR=0
  C_PURPLE='' C_GREEN='' C_BLUE='' C_CYAN='' C_PEACH='' C_RED=''
  C_DIM='' C_BOLD='' C_UNDERLINE='' C_RESET='' C_BG='' C_MUTED=''
fi
