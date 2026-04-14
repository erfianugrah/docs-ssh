#!/bin/sh
# Builds a TSV search index: path<tab>title<tab>summary
# One line per file. Fast to search, tiny to read.
#
# Usage: sh build-index.sh /docs > /docs/_index.tsv
#
# Performance: single awk process reads all files (~55K) in one pass.
# Previous shell-loop approach spawned ~14 subprocesses per file (770K forks).
#
# Frontmatter extraction: detects YAML frontmatter (--- fences at line 1)
# and extracts title/description/oneline fields for better summaries.
# Fallback chain: frontmatter fields > heading extraction > first content line.

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
    in_frontmatter = 0
    fm_pending_multiline = 0
    fm_title = ""
    fm_desc = ""
  }

  # ── Frontmatter detection ────────────────────────────────────────
  # YAML frontmatter: --- at line 1 opens, next --- closes.

  FNR == 1 && /^---[ \t]*$/ {
    in_frontmatter = 1
    next
  }

  in_frontmatter && /^---[ \t]*$/ {
    in_frontmatter = 0
    next
  }

  # Heuristic: h2+ heading inside "frontmatter" means it was a false
  # positive (e.g. stray --- from stripped MDX). Exit FM, process normally.
  # Uses ## (not #) because # is a valid YAML comment prefix.
  in_frontmatter && /^## / {
    in_frontmatter = 0
    # Fall through to heading/content collection below
  }

  in_frontmatter {
    # Multi-line YAML continuation: indented lines after a >/>-/| scalar
    if (fm_pending_multiline && /^  /) {
      v = $0
      sub(/^  +/, "", v)
      if (v != "" && fm_desc == "") fm_desc = substr(v, 1, 300)
      fm_pending_multiline = 0
      next
    }
    fm_pending_multiline = 0

    # Extract title: field
    if (/^title:/) {
      v = $0
      sub(/^title: */, "", v)
      # Strip surrounding quotes (single or double)
      gsub(/^["'\'']|["'\'']$/, "", v)
      # Strip backtick wrapping (e.g. title: `"What'\''s new"`)
      gsub(/^`|`$/, "", v)
      if (v != "") fm_title = substr(v, 1, 200)
    }
    # Extract description: field (kubernetes, traefik, etc.)
    if (/^description:/) {
      v = $0
      sub(/^description: */, "", v)
      gsub(/^["'\'']|["'\'']$/, "", v)
      # Handle multi-line YAML scalars (description: > or description: >-)
      if (v ~ /^[>|]-?$/) {
        fm_pending_multiline = 1
      } else if (v != "") {
        fm_desc = substr(v, 1, 300)
      }
    }
    # Extract oneline: field (typescript)
    if (/^oneline:/) {
      v = $0
      sub(/^oneline: */, "", v)
      gsub(/^["'\'']|["'\'']$/, "", v)
      if (v != "" && fm_desc == "") fm_desc = substr(v, 1, 300)
    }
    next
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
    # If frontmatter was never closed, discard FM data (malformed/false positive)
    if (in_frontmatter) { fm_title = ""; fm_desc = "" }

    # Title priority: frontmatter title > first # heading > first content line
    final_title = fm_title
    if (final_title == "") final_title = title
    if (final_title == "" && content != "") final_title = substr(content, 1, 200)

    # Summary priority: frontmatter description > headings + first content line
    if (fm_desc != "") {
      summary = fm_desc
      # Append headings if we have room (description + headings = richer context)
      if (length(summary) < 200 && headings != "") {
        summary = summary " " substr(headings, 1, 300 - length(summary))
      }
    } else {
      summary = substr(headings, 1, 300) " " substr(content, 1, 200)
    }

    # Sanitise: strip ANSI escapes, tabs, control chars
    gsub(/\033\[[0-9;]*[A-Za-z]/, "", final_title)
    gsub(/\t/, " ", final_title)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", final_title)

    gsub(/\033\[[0-9;]*[A-Za-z]/, "", summary)
    gsub(/\t/, " ", summary)
    gsub(/[\001-\010\013\014\016-\037\177]/, "", summary)

    printf "%s\t%s\t%s\n", relpath, final_title, summary
  }
'
