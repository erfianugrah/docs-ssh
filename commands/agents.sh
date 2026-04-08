#!/bin/sh
# Generates agent instruction snippets in the right format for each tool.
#
# Usage:
#   ssh ... agents                → AGENTS.md (default, works for OpenCode/Copilot/Codex)
#   ssh ... agents claude         → CLAUDE.md format
#   ssh ... agents cursor         → .cursorrules format
#   ssh ... agents gemini         → GEMINI.md format
#   ssh ... agents skill          → SKILL.md (on-demand skill for any tool)
#   ssh ... agents opencode       → AGENTS.md (same as default)
#
# All formats contain the same comprehensive instructions; only the
# frontmatter/wrapper differs per tool.

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"
USER="docs"

# Dynamic parts from what's actually in the container
SOURCES=$(ls -1 /docs/ | grep -v '_index' | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
SOURCE_COUNT=$(ls -1 /docs/ | grep -v '_index' | wc -l | tr -d ' ')
FILE_COUNT=$(find /docs -type f | wc -l | tr -d ' ')
SSH="ssh -p $PORT $USER@$HOST"

# Parse subcommand from SSH_ORIGINAL_COMMAND (e.g. "agents claude" → "claude")
FORMAT="${SSH_ORIGINAL_COMMAND#agents}"
FORMAT=$(echo "$FORMAT" | sed 's/^ *//' | tr '[:upper:]' '[:lower:]')
: "${FORMAT:=default}"

# ─── Skill frontmatter (only for skill format) ─────────────────────

emit_skill_frontmatter() {
  cat << SKILL_FM
---
name: docs-ssh
description: Search and read documentation for ${SOURCES} over SSH. Use when working with any of these technologies, debugging issues, or implementing features.
---

SKILL_FM
}

# ─── Core instructions (shared by all formats) ─────────────────────

emit_instructions() {
  cat << EOF
## Documentation

A docs server at \`$HOST\` serves ${FILE_COUNT}+ documentation pages across ${SOURCE_COUNT} sources as searchable markdown files over SSH. Always check docs before implementing features, debugging issues, or answering questions about these technologies.

### SSH connection

All commands use: \`$SSH "<command>"\`

To suppress host key warnings (recommended for automation), add these SSH options:
\`-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR\`

Or add to \`~/.ssh/config\`:

\`\`\`
Host $HOST
  User $USER
  Port $PORT
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  LogLevel ERROR
\`\`\`

### Available sources

${SOURCES}

All docs live under \`/docs/{source}/\` as markdown files.

### Recommended workflow

Use a **search → summary → targeted read** pattern to minimise token usage:

1. **Search** the index to find relevant files:
   \`\`\`bash
   $SSH "rg -i 'RLS policies' /docs/_index.tsv"
   \`\`\`

2. **Get the outline** of a promising file:
   \`\`\`bash
   $SSH "rg '^#' /docs/supabase/guides/auth.md"
   \`\`\`

3. **Read only the section you need** (e.g. lines 45-80):
   \`\`\`bash
   $SSH "bat --plain --paging=never --color=never --line-range=45:80 /docs/supabase/guides/auth.md"
   \`\`\`

### Available tools

| Tool | Purpose | Example |
|------|---------|---------|
| \`rg\` (ripgrep) | Fast regex search across files | \`rg -i 'pattern' /docs/supabase/\` |
| \`rg --json\` | Structured search with exact line numbers | \`rg --json 'auth' /docs/supabase/\` |
| \`grep\` | Basic text search | \`grep -rl 'query' /docs/\` |
| \`bat\` | Read files with line numbers | \`bat --plain --paging=never /docs/file.md\` |
| \`bat --line-range\` | Read specific line ranges | \`bat --plain --paging=never --line-range=10:50 /docs/file.md\` |
| \`cat\` | Read entire files (no line numbers) | \`cat /docs/file.md\` |
| \`head\`/\`tail\` | Read start/end of files | \`head -30 /docs/file.md\` |
| \`find\` | Find files by name pattern | \`find /docs/aws -name '*lambda*'\` |
| \`tree\` | Browse directory structure | \`tree /docs/cloudflare/ -L 2\` |
| \`wc\` | Count lines/words/files | \`find /docs/vercel -name '*.md' \| wc -l\` |
| \`less\` | Page through large files (interactive) | \`less /docs/file.md\` |

### Common patterns

\`\`\`bash
# Search across ALL docs for a topic
$SSH "rg -il 'edge functions' /docs/"

# Search within a specific source
$SSH "rg -i 'deploy' /docs/cloudflare/"

# Search with context lines around matches
$SSH "rg -i -C3 'CREATE POLICY' /docs/postgres/"

# Get structured JSON results with exact line numbers
$SSH "rg --json 'partial index' /docs/postgres/"

# Browse what's available in a source
$SSH "tree /docs/nextjs/ -L 2"

# Read a file with line numbers for precise references
$SSH "bat --plain --paging=never --color=never /docs/postgres/indexes.md"

# Read only lines 10-40 of a file
$SSH "bat --plain --paging=never --color=never --line-range=10:40 /docs/postgres/indexes.md"

# Search the pre-built index (fastest — searches titles and summaries)
$SSH "rg -i 'authentication' /docs/_index.tsv | head -10"

# Search index filtered to one source
$SSH "rg -i 'auth' /docs/_index.tsv | rg '^supabase/'"

# Get all headings in a file (document outline)
$SSH "rg '^#' /docs/supabase/guides/auth.md"

# Pipe and combine commands
$SSH "rg -il 'cron' /docs/ | head -5 | while read f; do echo \"--- \\\$f ---\"; head -3 \"\\\$f\"; done"
\`\`\`

### Performance tips

- **Search the index first**: \`rg -i 'query' /docs/_index.tsv\` searches titles+summaries (~1MB) instead of all docs (~300MB).
- **Use \`rg\` over \`grep\`**: ripgrep is 10-50x faster for large directory searches.
- **Limit output**: Pipe through \`head -N\` when searching broadly to avoid overwhelming context.
- **Use \`--line-range\`**: Read specific sections instead of entire files (30 lines ~120 tokens vs 500 lines ~2K tokens).
- **Use \`-l\` for file lists**: \`rg -il 'pattern'\` returns only filenames, not content.
- **Get structure first**: \`rg '^#' /docs/file.md\` shows headings before reading full file.
EOF
}

# ─── Format-specific output ─────────────────────────────────────────

case "$FORMAT" in
  skill)
    emit_skill_frontmatter
    emit_instructions
    ;;
  claude)
    echo "# CLAUDE.md"
    echo ""
    emit_instructions
    ;;
  cursor)
    emit_instructions
    ;;
  gemini)
    echo "# GEMINI.md"
    echo ""
    emit_instructions
    ;;
  help|--help|-h)
    cat << 'USAGE'
Usage: ssh ... agents [format]

Formats:
  (default)    AGENTS.md — works for OpenCode, GitHub Copilot, Codex
  opencode     Same as default
  claude       CLAUDE.md with header
  cursor       .cursorrules format
  gemini       GEMINI.md with header
  skill        SKILL.md with YAML frontmatter (on-demand skill for any tool)

Examples:
  ssh ... agents >> AGENTS.md
  ssh ... agents claude >> CLAUDE.md
  ssh ... agents skill > .opencode/skills/docs-ssh/SKILL.md
  ssh ... agents skill > .claude/skills/docs-ssh/SKILL.md
  ssh ... agents skill > .cursor/skills/docs-ssh/SKILL.md
USAGE
    ;;
  default|opencode|*)
    emit_instructions
    ;;
esac
