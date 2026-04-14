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
  case "$name" in _*) continue ;; esac
  case "$name" in *-api) continue ;; esac
  count=$(find "$d" -type f | wc -l)
  [ "$first" -eq 0 ] && printf ','
  jq -nc --arg name "$name" --argjson count "$count" '{name:$name,count:$count}'
  first=0
done
printf '],"api":['
first=1
for d in "$DOCS_ROOT"/*-api/; do
  [ ! -d "$d" ] && continue
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  [ "$first" -eq 0 ] && printf ','
  jq -nc --arg name "$name" --argjson count "$count" '{name:$name,count:$count}'
  first=0
done
printf ']}'
