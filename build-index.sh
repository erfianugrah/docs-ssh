#!/bin/sh
# Builds a TSV search index: path<tab>title<tab>summary
# One line per file. Fast to search, tiny to read.
#
# Usage: sh build-index.sh /docs > /docs/_index.tsv
#
# The index is a search OPTIMIZATION — not a filter. Every .md file gets
# an entry. Files with poor/missing titles are still discoverable via
# docs_grep (content search) and docs_find (filename search) at runtime.
#
# Frontmatter extraction: detects YAML frontmatter (--- fences at line 1)
# and extracts title/description/oneline fields for better summaries.
# Fallback chain: frontmatter fields > heading extraction > first content line.

DOCS_ROOT="${1:-/docs}"

find "$DOCS_ROOT" -type f -name '*.md' -print0 | sort -z | \
xargs -0 awk -v root="$DOCS_ROOT/" '
  # ── Per-file processing ──────────────────────────────────────────

  FNR == 1 {
    if (relpath != "") emit()

    relpath = FILENAME
    sub(root, "", relpath)
    title = ""
    headings = ""
    heading_count = 0
    content = ""
    got_content = 0
    in_fence = 0
    in_frontmatter = 0
    fm_pending_multiline = 0
    fm_title = ""
    fm_desc = ""
  }

  # ── Frontmatter detection ────────────────────────────────────────

  FNR == 1 && /^---[ \t]*$/ {
    in_frontmatter = 1
    next
  }

  in_frontmatter && /^---[ \t]*$/ {
    in_frontmatter = 0
    next
  }

  in_frontmatter && /^## / {
    in_frontmatter = 0
  }

  in_frontmatter {
    if (fm_pending_multiline && /^  /) {
      v = $0
      sub(/^  +/, "", v)
      if (v != "" && fm_desc == "") fm_desc = substr(v, 1, 300)
      fm_pending_multiline = 0
      next
    }
    fm_pending_multiline = 0

    if (/^title:/) {
      v = $0
      sub(/^title: */, "", v)
      gsub(/^["'\''"]|["'\''"]$/, "", v)
      gsub(/^`|`$/, "", v)
      if (v != "") fm_title = substr(v, 1, 200)
    }
    if (/^description:/) {
      v = $0
      sub(/^description: */, "", v)
      gsub(/^["'\''"]|["'\''"]$/, "", v)
      if (v ~ /^[>|]-?$/) {
        fm_pending_multiline = 1
      } else if (v != "") {
        fm_desc = substr(v, 1, 300)
      }
    }
    if (/^oneline:/) {
      v = $0
      sub(/^oneline: */, "", v)
      gsub(/^["'\''"]|["'\''"]$/, "", v)
      if (v != "" && fm_desc == "") fm_desc = substr(v, 1, 300)
    }
    next
  }

  # ── Content collection ───────────────────────────────────────────

  /^```/ || /^~~~/ { in_fence = !in_fence; next }

  /^#/ && !in_fence && title == "" {
    t = $0
    sub(/^#+ */, "", t)
    title = substr(t, 1, 200)
  }

  /^#/ && !in_fence && heading_count < 5 {
    h = $0
    sub(/^#+ */, "", h)
    headings = headings " " h
    heading_count++
  }

  # First prose line: requires 3+ alpha chars, skips code/markup lines
  /^[^#`\-\|<>![]/ && !in_fence && !got_content && /[A-Za-z].*[A-Za-z].*[A-Za-z]/ {
    content = substr($0, 1, 200)
    got_content = 1
  }

  END { if (relpath != "") emit() }

  # ── Output ───────────────────────────────────────────────────────

  function emit() {
    if (in_frontmatter) { fm_title = ""; fm_desc = "" }

    # Title: frontmatter > heading > first content line
    final_title = fm_title
    if (final_title == "") final_title = title
    if (final_title == "" && content != "") final_title = substr(content, 1, 200)

    # Summary: frontmatter description > headings + content
    if (fm_desc != "") {
      summary = fm_desc
      if (length(summary) < 200 && headings != "") {
        summary = summary " " substr(headings, 1, 300 - length(summary))
      }
    } else {
      summary = substr(headings, 1, 300) " " substr(content, 1, 200)
    }

    # Sanitise: strip ANSI, tabs, \r, control chars
    gsub(/\033\[[0-9;]*[A-Za-z]/, "", final_title)
    gsub(/\t/, " ", final_title)
    gsub(/\r/, "", final_title)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", final_title)

    gsub(/\033\[[0-9;]*[A-Za-z]/, "", summary)
    gsub(/\t/, " ", summary)
    gsub(/\r/, "", summary)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", summary)

    printf "%s\t%s\t%s\n", relpath, final_title, summary
  }
'
