#!/bin/sh
# Builds a TSV search index: path<tab>title<tab>summary
# One line per file. Fast to search, tiny to read.
#
# Usage: sh build-index.sh /docs > /docs/_index.tsv

DOCS_ROOT="${1:-/docs}"

# Sanitise: strip ANSI escapes, tabs, control chars from a string
sanitise() {
  printf '%s' "$1" | \
    sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | \
    tr '\t\r' '  ' | \
    tr -d '\000-\010\013\014\016-\037\177'
}

find "$DOCS_ROOT" -type f \( -name '*.md' -o -name '*.html' \) | sort | while IFS= read -r file; do
  relpath="${file#$DOCS_ROOT/}"

  # Extract title: first # heading, or first non-empty line
  title=$(grep -m1 '^#' "$file" 2>/dev/null | sed 's/^#* *//' | head -c 200)
  if [ -z "$title" ]; then
    title=$(head -1 "$file" | head -c 200)
  fi

  # Extract summary: first non-heading, non-empty content line
  summary=$(sed -n '/^[^#]/p' "$file" | grep -m1 '[A-Za-z]' | head -c 300)

  # Sanitise both fields
  title=$(sanitise "$title")
  summary=$(sanitise "$summary")

  printf '%s\t%s\t%s\n' "$relpath" "$title" "$summary"
done
