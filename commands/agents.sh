#!/bin/sh
# Generates agent instruction snippets in the right format for each tool.
#
# Usage:
#   ssh ... agents                → AGENTS.md (raw SSH patterns for any agent)
#   ssh ... agents opencode       → AGENTS.md tuned for OpenCode (references custom tools)
#   ssh ... agents claude         → CLAUDE.md format (raw SSH)
#   ssh ... agents cursor         → .cursorrules format (raw SSH)
#   ssh ... agents gemini         → GEMINI.md format (raw SSH)
#   ssh ... agents skill          → SKILL.md with YAML frontmatter
#   ssh ... agents help           → show all formats

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"
USER="docs"

# Dynamic parts from what's actually in the container
ALL_SOURCES=$(ls -1 /docs/ | grep -v '^_')
DOC_SOURCES=$(echo "$ALL_SOURCES" | grep -v '\-api$' | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
API_SOURCES=$(echo "$ALL_SOURCES" | grep '\-api$' | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
SOURCES=$(echo "$ALL_SOURCES" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
SOURCE_COUNT=$(echo "$ALL_SOURCES" | wc -l | tr -d ' ')
FILE_COUNT=$(find /docs -type f | wc -l | tr -d ' ')
SSH="ssh -p $PORT $USER@$HOST"

# ─── Dynamic example data ───────────────────────────────────────────
# File paths, line numbers, and grep patterns resolved from the live
# index + actual files.  Search queries use stable concepts ("row
# security", "dns record") — the underlying file paths are what
# changes between doc refreshes.

# Doc workflow: postgres "row security" (universal, always present)
_eg_doc=$(rg -i 'row security' /docs/_index.tsv 2>/dev/null | grep '^postgres/' | head -1 | cut -f1)
: "${_eg_doc:=postgres/ddl-rowsecurity.md}"
EG_DOC="/docs/$_eg_doc"
EG_DOC_H2=$(rg -n '^## ' "$EG_DOC" 2>/dev/null | head -1 | cut -d: -f1)
: "${EG_DOC_H2:=1}"
EG_DOC_END=$((EG_DOC_H2 + 34))

# API lookup: cloudflare-api "dns record" (stable, well-known endpoint)
_eg_api=$(rg -i 'dns.record' /docs/_index.tsv 2>/dev/null | grep '^cloudflare-api/' | head -1 | cut -f1)
: "${_eg_api:=cloudflare-api/api/dns-records-for-a-zone.md}"
EG_API="/docs/$_eg_api"
EG_API_GREP=$(rg '^## POST ' "$EG_API" 2>/dev/null | head -1 | sed 's|.*/||; s/ .*//')
: "${EG_API_GREP:=dns_records}"

# Parse subcommand from SSH_ORIGINAL_COMMAND (e.g. "agents claude" → "claude")
FORMAT="${SSH_ORIGINAL_COMMAND#agents}"
FORMAT=$(echo "$FORMAT" | sed 's/^ *//' | tr '[:upper:]' '[:lower:]')
: "${FORMAT:=default}"

# ─── Skill frontmatter ──────────────────────────────────────────────

emit_skill_frontmatter() {
  cat << SKILL_FM
---
name: docs-ssh
description: Search and read documentation for ${SOURCES} over SSH. Use when working with any of these technologies, debugging issues, or implementing features.
---

SKILL_FM
}

# ─── Instructions for agents WITH custom tools installed ────────────
# OpenCode has docs_search, docs_read, docs_grep, docs_find, docs_summary,
# docs_sources as first-class tools.  The agent should NEVER fall back to
# raw SSH — the tools handle connection, output capping, and structured
# parsing automatically.

emit_tools_instructions() {
  cat << EOF
## Documentation

Docs server at \`$HOST\` — ${SOURCE_COUNT} sources (docs + API specs), searchable markdown over SSH. Check docs before implementing/debugging.

**Always use custom \`docs_search\`, \`docs_read\`, \`docs_grep\`, \`docs_find\`, \`docs_summary\`, \`docs_sources\` tools.** No raw \`ssh\` or \`Bash\` for docs access.

### Sources

${DOC_SOURCES}

### API Reference Sources

OpenAPI specs converted to per-endpoint-group markdown. Each has \`api/overview.md\` (endpoint index) + \`api/{tag}.md\` files.

${API_SOURCES}

**API lookup pattern:**
1. \`docs_search(query="dns record", source="cloudflare-api")\` — find endpoint group
2. \`docs_grep(query="POST.*${EG_API_GREP}", path="/docs/cloudflare-api/")\` — find exact endpoint
3. \`docs_read(path="${EG_API}")\` — read full endpoint group

### Workflow: search -> summary -> targeted read

1. **Search** index for relevant files:
   \`docs_search(query="row security", source="postgres")\`

2. **Outline** promising file:
   \`docs_summary(path="${EG_DOC}")\`

3. **Read only needed section** (e.g. lines ${EG_DOC_H2}-${EG_DOC_END}):
   \`docs_read(path="${EG_DOC}", offset=${EG_DOC_H2}, lines=35)\`

### Tools

| Tool | Purpose | When |
|------|---------|------|
| \`docs_search\` | Search titles+summaries | First step — find files fast (index ~15x smaller than raw docs) |
| \`docs_summary\` | Headings/outline of file | Before reading — find right section |
| \`docs_read\` | Read file or line range | After summary — read only what needed |
| \`docs_grep\` | Regex search + context lines | Find content within files |
| \`docs_find\` | Find files by name pattern | Know part of filename |
| \`docs_sources\` | List sources + file counts | Check what available |

### Token tips

- \`docs_search\` searches index (~15x smaller than raw docs)
- \`docs_summary\` before \`docs_read\` — find right line range first
- \`offset+lines\`: 35 lines = ~140 tokens vs ~2K for full file
- \`docs_grep\` with source path: \`docs_grep(query="RLS", path="/docs/postgres/")\` faster than searching all
- \`source\` param: \`docs_search(query="auth", source="supabase")\` filters to one source
- API specs: \`docs_read(path="/docs/{source}-api/api/overview.md")\` for endpoint index

### Related source groups

When searching one source, check related sources for cross-referencing:

- **Auth & identity**: supabase, keycloak, authentik, openid, saml, bitwarden, vaultwarden
- **Databases**: postgres, supabase, drizzle, prisma, sqlite, redis, valkey
- **Infrastructure**: docker, kubernetes, k3s, terraform, ansible, flyio, helm, argocd, sst
- **Reverse proxy & networking**: cloudflare, caddy, traefik, wireguard
- **Frontend frameworks**: nextjs, react, astro, hono, tailwindcss, shadcn, svelte, htmx, tanstack, effect
- **Languages & runtimes**: typescript, python, rust-book, bun, deno, go, zod, nix
- **Cloud platforms**: aws, cloudflare, vercel, flyio
- **Build tools**: vite, vitest, turborepo, rspack, eslint, prettier, pnpm
- **Testing**: vitest, jest, playwright, cypress
- **Mobile & desktop**: react-native, flutter, expo, tauri, wails
- **Monitoring & observability**: prometheus, opentelemetry, grafana
- **Secrets & encryption**: age, sops, bitwarden, vaultwarden
- **Terminal & editor**: neovim, tmux, wezterm, zsh, ohmyzsh, mise
- **CLI tools**: curl, ripgrep, httpie, rclone
- **Git forges**: github, gitlab, gitea
- **APIs & specs**: graphql, graphql-spec, openid, saml, mcp
- **Docs & diagrams**: mdn, d2, mermaid, starlight, mcp
- **Email & services**: resend, letsencrypt
EOF
}

# ─── Instructions for agents WITHOUT custom tools (raw SSH) ─────────
# Claude Code, Cursor, Gemini, Copilot, etc. use their Bash tool to
# run SSH commands directly.

emit_ssh_instructions() {
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

### Sources

${DOC_SOURCES}

All docs live under \`/docs/{source}/\` as markdown files.

### API Reference Sources

OpenAPI specs converted to per-endpoint-group markdown. Each has \`api/overview.md\` (endpoint index) + \`api/{tag}.md\` files.

${API_SOURCES}

**API lookup pattern:**
\`\`\`bash
# Find endpoint group
$SSH "rg -i 'dns record' /docs/cloudflare-api/api/overview.md"
# Find exact endpoint
$SSH "rg 'POST.*${EG_API_GREP}' /docs/cloudflare-api/"
# Read full endpoint group
$SSH "bat --plain --paging=never --color=never ${EG_API}"
\`\`\`

### Recommended workflow

Use a **search → summary → targeted read** pattern to minimise token usage:

1. **Search** the index to find relevant files:
   \`\`\`bash
   $SSH "rg -i 'row security' /docs/_index.tsv"
   \`\`\`

2. **Get the outline** of a promising file:
   \`\`\`bash
   $SSH "rg -n '^#' ${EG_DOC}"
   \`\`\`

3. **Read only the section you need** (e.g. lines ${EG_DOC_H2}-${EG_DOC_END}):
   \`\`\`bash
   $SSH "bat --plain --paging=never --color=never --line-range=${EG_DOC_H2}:${EG_DOC_END} ${EG_DOC}"
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
$SSH "bat --plain --paging=never --color=never ${EG_DOC}"

# Read only lines 10-40 of a file
$SSH "bat --plain --paging=never --color=never --line-range=10:40 ${EG_DOC}"

# Search the pre-built index (fastest — searches titles and summaries)
$SSH "rg -i 'authentication' /docs/_index.tsv | head -10"

# Search index filtered to one source
$SSH "rg -i 'auth' /docs/_index.tsv | rg '^supabase/'"

# Get all headings in a file (document outline)
$SSH "rg -n '^#' ${EG_DOC}"

# Pipe and combine commands
$SSH "rg -il 'cron' /docs/ | head -5 | while read f; do echo \"--- \\\$f ---\"; head -3 \"\\\$f\"; done"
\`\`\`

### Performance tips

- **Search the index first**: \`rg -i 'query' /docs/_index.tsv\` searches titles+summaries (index is ~15x smaller than raw docs).
- **Use \`rg\` over \`grep\`**: ripgrep is 10-50x faster for large directory searches.
- **Limit output**: Pipe through \`head -N\` when searching broadly to avoid overwhelming context.
- **Use \`--line-range\`**: Read specific sections instead of entire files (30 lines ~120 tokens vs 500 lines ~2K tokens).
- **Use \`-l\` for file lists**: \`rg -il 'pattern'\` returns only filenames, not content.
- **Get structure first**: \`rg -n '^#' /docs/file.md\` shows headings with line numbers before reading full file.

### Related source groups

When searching one source, check related sources for cross-referencing:

- **Auth & identity**: supabase, keycloak, authentik, openid, saml, bitwarden, vaultwarden
- **Databases**: postgres, supabase, drizzle, prisma, sqlite, redis, valkey
- **Infrastructure**: docker, kubernetes, k3s, terraform, ansible, flyio, helm, argocd, sst
- **Reverse proxy & networking**: cloudflare, caddy, traefik, wireguard
- **Frontend frameworks**: nextjs, react, astro, hono, tailwindcss, shadcn, svelte, htmx, tanstack, effect
- **Languages & runtimes**: typescript, python, rust-book, bun, deno, go, zod, nix
- **Cloud platforms**: aws, cloudflare, vercel, flyio
- **Build tools**: vite, vitest, turborepo, rspack, eslint, prettier, pnpm
- **Testing**: vitest, jest, playwright, cypress
- **Mobile & desktop**: react-native, flutter, expo, tauri, wails
- **Monitoring & observability**: prometheus, opentelemetry, grafana
- **Secrets & encryption**: age, sops, bitwarden, vaultwarden
- **Terminal & editor**: neovim, tmux, wezterm, zsh, ohmyzsh, mise
- **CLI tools**: curl, ripgrep, httpie, rclone
- **Git forges**: github, gitlab, gitea
- **APIs & specs**: graphql, graphql-spec, openid, saml, mcp
- **Docs & diagrams**: mdn, d2, mermaid, starlight, mcp
- **Email & services**: resend, letsencrypt
EOF
}

# ─── Format routing ──────────────────────────────────────────────────

case "$FORMAT" in
  opencode)
    # OpenCode has custom tools — tell agent to use them, not raw SSH
    emit_tools_instructions
    ;;
  skill)
    emit_skill_frontmatter
    emit_ssh_instructions
    ;;
  claude)
    echo "# CLAUDE.md"
    echo ""
    emit_ssh_instructions
    ;;
  cursor)
    emit_ssh_instructions
    ;;
  gemini)
    echo "# GEMINI.md"
    echo ""
    emit_ssh_instructions
    ;;
  help|--help|-h)
    cat << 'USAGE'
Usage: ssh ... agents [format]

Formats:
  (default)    AGENTS.md — raw SSH patterns for any agent
  opencode     AGENTS.md tuned for OpenCode (references custom docs_* tools)
  claude       CLAUDE.md with header
  cursor       .cursorrules format
  gemini       GEMINI.md with header
  skill        SKILL.md with YAML frontmatter (on-demand skill for any tool)

Examples:
  ssh ... agents >> AGENTS.md
  ssh ... agents opencode > ~/.config/opencode/AGENTS.md
  ssh ... agents claude >> CLAUDE.md
  ssh ... agents cursor >> .cursorrules
  ssh ... agents gemini >> GEMINI.md
  ssh ... agents skill > .opencode/skills/docs-ssh/SKILL.md
USAGE
    ;;
  default|*)
    # Default: raw SSH patterns (works with any agent)
    emit_ssh_instructions
    ;;
esac
