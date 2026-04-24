#!/bin/sh
# Post-build health check for normalised docs and search index.
# Reports warnings about quality issues — never fails the build.
#
# Usage: sh build-health-check.sh /docs /docs/_index.tsv
#
# Checks:
#   1. Empty files (0 bytes) — normaliser produced nothing
#   2. Tiny files (<50 bytes) — likely stubs with no real content
#   3. Index entries with no title — low quality search results
#   4. Index entries with no summary — low quality search results
#   5. Sources with 0 files — total ingest failure

DOCS_ROOT="${1:-/docs}"
INDEX_FILE="${2:-$DOCS_ROOT/_index.tsv}"

TINY_THRESHOLD=50     # bytes — title-only stubs

# ─── Counts ────────────────────────────────────────────────────────

total_files=$(find "$DOCS_ROOT" -type f \( -name '*.md' -o -name '*.html' \) | wc -l)
total_index=$(wc -l < "$INDEX_FILE" 2>/dev/null || echo 0)
total_sources=$(find "$DOCS_ROOT" -mindepth 1 -maxdepth 1 -type d ! -name '_*' | wc -l)

empty_files=$(find "$DOCS_ROOT" -type f \( -name '*.md' -o -name '*.html' \) -empty | wc -l)
tiny_files=$(find "$DOCS_ROOT" -type f \( -name '*.md' -o -name '*.html' \) -size -${TINY_THRESHOLD}c ! -empty | wc -l)

no_title=$(awk -F'\t' '$2 == ""' "$INDEX_FILE" | wc -l)
no_summary=$(awk -F'\t' '$3 == "" || $3 ~ /^[[:space:]]*$/' "$INDEX_FILE" | wc -l)
html_title=$(awk -F'\t' '$2 ~ /^<[!A-Za-z]/ || $2 ~ /\{/' "$INDEX_FILE" | wc -l)
css_content=$(grep -rl '{.*:.*}' "$DOCS_ROOT" --include='*.md' 2>/dev/null | head -100 | wc -l)

# ─── Summary ──────────────────────────────────────────────────────

echo "[health] ${total_index} files indexed across ${total_sources} sources (${total_files} total on disk)"

warn_count=0

if [ "$empty_files" -gt 0 ]; then
  echo "[health] WARN: ${empty_files} empty files (0 bytes)"
  warn_count=$((warn_count + 1))
fi

if [ "$tiny_files" -gt 0 ]; then
  echo "[health] WARN: ${tiny_files} files under ${TINY_THRESHOLD} bytes (title-only stubs)"
  warn_count=$((warn_count + 1))
fi

if [ "$no_title" -gt 0 ]; then
  echo "[health] WARN: ${no_title} index entries with no title"
  warn_count=$((warn_count + 1))
fi

if [ "$no_summary" -gt 0 ]; then
  echo "[health] WARN: ${no_summary} index entries with no summary"
  warn_count=$((warn_count + 1))
fi

if [ "$html_title" -gt 0 ]; then
  echo "[health] WARN: ${html_title} index entries with HTML/CSS in title"
  warn_count=$((warn_count + 1))
fi

# ─── Per-source breakdown (top offenders) ─────────────────────────

if [ "$warn_count" -gt 0 ]; then
  echo "[health] Per-source breakdown:"

  for d in "$DOCS_ROOT"/*/; do
    [ ! -d "$d" ] && continue
    name=$(basename "$d")
    case "$name" in _*) continue ;; esac

    s_empty=$(find "$d" -type f \( -name '*.md' -o -name '*.html' \) -empty | wc -l)
    s_tiny=$(find "$d" -type f \( -name '*.md' -o -name '*.html' \) -size -${TINY_THRESHOLD}c ! -empty | wc -l)
    s_no_title=$(awk -F'\t' -v src="$name/" 'index($1, src) == 1 && $2 == ""' "$INDEX_FILE" | wc -l)

    issues=""
    [ "$s_empty" -gt 0 ] && issues="${issues} ${s_empty} empty"
    [ "$s_tiny" -gt 0 ] && issues="${issues} ${s_tiny} tiny"
    [ "$s_no_title" -gt 0 ] && issues="${issues} ${s_no_title} no-title"

    [ -n "$issues" ] && echo "[health]   ${name}:${issues}"
  done
fi

if [ "$warn_count" -eq 0 ]; then
  echo "[health] No issues found"
fi
