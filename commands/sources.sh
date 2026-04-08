#!/bin/sh
# Dynamic — always reflects what's actually in the container.
# Sources lib/colors.sh for TTY-aware coloring.

LIB_DIR="$(dirname "$0")/lib"
. "$LIB_DIR/colors.sh"

printf '%s%sAvailable documentation sources:%s\n\n' "${C_BOLD}" "${C_PURPLE}" "${C_RESET}"

for d in /docs/*/; do
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  size=$(du -sh "$d" | cut -f1)
  printf "  %s%-20s%s %s%6s files%s  %s%s%s\n" \
    "${C_GREEN}" "$name" "${C_RESET}" \
    "${C_BOLD}" "$count" "${C_RESET}" \
    "${C_DIM}" "$size" "${C_RESET}"
done

echo ""
total=$(find /docs -type f | wc -l)
printf '%sTotal:%s %s%s files%s\n' \
  "${C_BOLD}" "${C_RESET}" "${C_PURPLE}" "$total" "${C_RESET}"
