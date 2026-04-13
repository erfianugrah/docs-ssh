#!/bin/sh
# Generates /docs/_sources.json at Docker build time from actual /docs/ contents.
# Used by the landing page to render source grid and count dynamically.
#
# Usage: sh build-sources-json.sh /docs > /docs/_sources.json

DOCS_ROOT="${1:-/docs}"

printf '{"docs":['
first=1
for d in "$DOCS_ROOT"/*/; do
  name=$(basename "$d")
  [ "$name" = "_index.tsv" ] && continue
  case "$name" in *-api) continue ;; esac
  count=$(find "$d" -type f | wc -l)
  [ $first -eq 0 ] && printf ','
  printf '{"name":"%s","count":%d}' "$name" "$count"
  first=0
done
printf '],"api":['
first=1
for d in "$DOCS_ROOT"/*-api/; do
  [ ! -d "$d" ] && continue
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  [ $first -eq 0 ] && printf ','
  printf '{"name":"%s","count":%d}' "$name" "$count"
  first=0
done
printf ']}'
