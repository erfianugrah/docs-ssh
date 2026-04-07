#!/bin/sh
# Dynamic — always reflects what's actually in the container
echo "Available documentation sources:"
echo ""
for d in /docs/*/; do
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  size=$(du -sh "$d" | cut -f1)
  printf "  %-20s %6s files  %s\n" "$name" "$count" "$size"
done
echo ""
total=$(find /docs -type f | wc -l)
echo "Total: $total files"
