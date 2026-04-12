#!/bin/sh
# Builds a TSV search index: path<tab>title<tab>summary
# One line per file. Fast to search, tiny to read.
#
# Usage: sh build-index.sh /docs > /docs/_index.tsv
#
# Performance: single awk process reads all files (~55K) in one pass.
# Previous shell-loop approach spawned ~14 subprocesses per file (770K forks).

DOCS_ROOT="${1:-/docs}"

find "$DOCS_ROOT" -type f \( -name '*.md' -o -name '*.html' \) -print0 | sort -z | \
xargs -0 awk -v root="$DOCS_ROOT/" '
  # ── Per-file processing ──────────────────────────────────────────

  FNR == 1 {
    # Emit previous file (if any)
    if (relpath != "") emit()

    # Reset state for new file
    relpath = FILENAME
    sub(root, "", relpath)
    title = ""
    headings = ""
    heading_count = 0
    content = ""
    got_content = 0
    in_fence = 0
  }

  # Track fenced code blocks (``` or ~~~) — skip # inside them
  /^```/ || /^~~~/ { in_fence = !in_fence; next }

  # Collect title: first # heading (outside code blocks)
  /^#/ && !in_fence && title == "" {
    t = $0
    sub(/^#+ */, "", t)
    title = substr(t, 1, 200)
  }

  # Collect up to 5 headings for summary (outside code blocks)
  /^#/ && !in_fence && heading_count < 5 {
    h = $0
    sub(/^#+ */, "", h)
    headings = headings " " h
    heading_count++
  }

  # Collect first non-heading content line (outside code blocks)
  /^[^#]/ && !in_fence && !got_content && /[A-Za-z]/ {
    content = substr($0, 1, 200)
    got_content = 1
  }

  END { if (relpath != "") emit() }

  # ── Output ───────────────────────────────────────────────────────

  function emit() {
    # Fallback title: first line of file (already past, use what we have)
    if (title == "" && content != "") title = substr(content, 1, 200)

    # Build summary: headings + first content line
    summary = substr(headings, 1, 300) " " substr(content, 1, 200)

    # Sanitise: strip ANSI escapes, tabs, control chars
    gsub(/\033\[[0-9;]*[A-Za-z]/, "", title)
    gsub(/\t/, " ", title)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", title)

    gsub(/\033\[[0-9;]*[A-Za-z]/, "", summary)
    gsub(/\t/, " ", summary)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", summary)

    printf "%s\t%s\t%s\n", relpath, title, summary
  }
'
