#!/bin/sh
# Brand colors and TTY detection.
# Source this file — it exports USE_COLOR and C_* variables.
#
# Colors match the CSS vars in public/index.html:
#   --purple: #c574dd   --green: #5adecd   --blue: #8796f4
#   --cyan: #79e6f3     --peach: #f1a171   --red: #f37e96
#   --surface: #282a36  --fg-muted: #bdbdc1
#
# When stdout is not a TTY (agent exec mode), all vars are empty strings
# so printf/echo calls degrade to plain text with zero overhead.

if [ -t 1 ]; then
  USE_COLOR=1
  C_PURPLE='\033[38;2;197;116;221m'
  C_GREEN='\033[38;2;90;222;205m'
  C_BLUE='\033[38;2;135;150;244m'
  C_CYAN='\033[38;2;121;230;243m'
  C_PEACH='\033[38;2;241;161;113m'
  C_RED='\033[38;2;243;126;150m'
  C_DIM='\033[2m'
  C_BOLD='\033[1m'
  C_UNDERLINE='\033[4m'
  C_RESET='\033[0m'
  C_BG='\033[48;2;40;42;54m'
  # Muted foreground — for secondary text, comments, separators
  C_MUTED='\033[38;2;189;189;193m'
else
  USE_COLOR=0
  C_PURPLE='' C_GREEN='' C_BLUE='' C_CYAN='' C_PEACH='' C_RED=''
  C_DIM='' C_BOLD='' C_UNDERLINE='' C_RESET='' C_BG='' C_MUTED=''
fi
