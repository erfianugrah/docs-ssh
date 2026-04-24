#!/bin/sh
# Post-build health report for normalised docs and search index.
# Reports stats about the build — never fails.
#
# Usage: sh build-health-check.sh /docs /docs/_index.tsv

DOCS_ROOT="${1:-/docs}"
INDEX_FILE="${2:-$DOCS_ROOT/_index.tsv}"

total_md=$(find "$DOCS_ROOT" -type f -name '*.md' | wc -l)
total_html=$(find "$DOCS_ROOT" -type f -name '*.html' | wc -l)
total_index=$(wc -l < "$INDEX_FILE" 2>/dev/null || echo 0)
total_sources=$(find "$DOCS_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '_*' | wc -l)
empty_sources=$(for d in "$DOCS_ROOT"/*/; do
  name=$(basename "$d"); case "$name" in _*) continue ;; esac
  count=$(find "$d" -type f -name '*.md' | wc -l)
  [ "$count" -eq 0 ] && echo "$name"
done | wc -l)

indexed_with_title=$(awk -F'\t' '$2 != ""' "$INDEX_FILE" | wc -l)
indexed_no_title=$(awk -F'\t' '$2 == ""' "$INDEX_FILE" | wc -l)

echo "[health] ${total_sources} sources, ${total_md} markdown files, ${total_html} unconverted HTML files"
echo "[health] ${total_index} indexed (${indexed_with_title} with title, ${indexed_no_title} title-only from path)"

if [ "$empty_sources" -gt 0 ]; then
  echo "[health] ${empty_sources} sources with 0 markdown files:"
  for d in "$DOCS_ROOT"/*/; do
    name=$(basename "$d"); case "$name" in _*) continue ;; esac
    count=$(find "$d" -type f -name '*.md' | wc -l)
    [ "$count" -eq 0 ] && echo "[health]   ${name}"
  done
fi

if [ "$total_html" -gt 0 ]; then
  echo "[health] ${total_html} .html files (unconverted — searchable via docs_grep, not indexed)"
fi
