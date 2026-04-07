#!/bin/sh
# Interactive setup guide — pipe to your agent for guided configuration.
# Usage: ssh -p 2222 docs@HOST setup | opencode
#        ssh -p 2222 docs@HOST setup | claude

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

cat << EOF
# docs-ssh setup

I'm a documentation server with $(find /docs -type f | wc -l) searchable docs across $(ls -1 /docs/ | wc -l) sources: $(ls -1 /docs/ | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g').

Please set me up in this project. Here's what to do:

## Option 1: OpenCode custom tools (recommended)

Create the tools file so the LLM gets docs_search, docs_read, docs_find, docs_grep, docs_summary, and docs_sources as first-class tools:

\`\`\`bash
mkdir -p .opencode/tools
ssh -p $PORT docs@$HOST tools > .opencode/tools/docs.ts
\`\`\`

Then add to your rules file (AGENTS.md, CLAUDE.md, etc.):

\`\`\`bash
ssh -p $PORT docs@$HOST agents >> AGENTS.md
\`\`\`

Make sure \`zod\` is installed (the tools file needs it):

\`\`\`bash
npm install --save-dev zod
\`\`\`

## Option 2: Just the AGENTS.md snippet

If you don't want custom tools, just add SSH instructions to your rules:

\`\`\`bash
ssh -p $PORT docs@$HOST agents >> AGENTS.md
\`\`\`

The agent will use its Bash tool to run SSH commands.

## Option 3: Skill file

Create a skill that agents load on demand:

\`\`\`bash
mkdir -p .opencode/skills/docs-ssh
cat > .opencode/skills/docs-ssh/SKILL.md << 'SKILL'
---
name: docs-ssh
description: Search documentation for Supabase, Cloudflare, Vercel, PostgreSQL, and AWS over SSH.
---

$(ssh -p $PORT docs@$HOST agents 2>/dev/null || echo "# Docs over SSH

Search docs with: ssh -p $PORT docs@$HOST \"grep -rl 'query' /docs/\"")
SKILL
\`\`\`

## Verify it works

\`\`\`bash
ssh -o StrictHostKeyChecking=no -p $PORT docs@$HOST "ls /docs/"
\`\`\`

Please run option 1 (custom tools + AGENTS.md) now.
EOF
