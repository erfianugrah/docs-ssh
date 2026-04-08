#!/bin/sh
# Interactive setup guide — pipe to your agent for guided configuration.
# Usage: ssh -p 2222 docs@HOST setup | opencode
#        ssh -p 2222 docs@HOST setup | claude

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

cat << EOF
# docs-ssh setup

I'm a documentation server with $(find /docs -type f | wc -l) searchable docs across $(ls -1 /docs/ | grep -v _index | wc -l) sources: $(ls -1 /docs/ | grep -v _index | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g').

Please set me up in this project. Here's what to do:

## Option 1: OpenCode custom tools (recommended)

Create the tools file so the LLM gets docs_search, docs_read, docs_find, docs_grep, docs_summary, and docs_sources as first-class tools. The grep tool uses \`rg --json\` for structured results with exact line numbers, and the read tool uses \`bat\` for line-numbered output:

\`\`\`bash
mkdir -p .opencode/tools
ssh -p $PORT docs@$HOST tools > .opencode/tools/docs.ts
\`\`\`

Then add to your rules file:

\`\`\`bash
ssh -p $PORT docs@$HOST agents >> AGENTS.md
\`\`\`

Make sure \`zod\` is installed (the tools file needs it):

\`\`\`bash
npm install --save-dev zod
\`\`\`

## Option 2: Append agent instructions to your rules file

If you don't want custom tools, just add SSH instructions. The \`agents\` command accepts a format argument:

| Tool | Command |
|------|---------|
| OpenCode / Copilot / Codex | \`ssh -p $PORT docs@$HOST agents >> AGENTS.md\` |
| Claude Code | \`ssh -p $PORT docs@$HOST agents claude >> CLAUDE.md\` |
| Cursor | \`ssh -p $PORT docs@$HOST agents cursor >> .cursorrules\` |
| Gemini CLI | \`ssh -p $PORT docs@$HOST agents gemini >> GEMINI.md\` |

The agent will use its Bash tool to run SSH commands directly. Available tools on the server: grep, rg (ripgrep, supports --json), find, cat, bat (syntax-aware cat with line numbers), head, tail, tree, wc, less.

## Option 3: Install as a skill

Skills are loaded on demand. Pick the path for your tool:

| Tool | Skill path |
|------|-----------|
| OpenCode | \`.opencode/skills/docs-ssh/SKILL.md\` |
| Claude Code | \`.claude/skills/docs-ssh/SKILL.md\` |
| Cursor | \`.cursor/skills/docs-ssh/SKILL.md\` or \`.agents/skills/docs-ssh/SKILL.md\` |
| Gemini CLI | \`.gemini/skills/docs-ssh/SKILL.md\` or \`.agents/skills/docs-ssh/SKILL.md\` |
| GitHub Copilot | \`.github/skills/docs-ssh/SKILL.md\` |
| Cross-client | \`.agents/skills/docs-ssh/SKILL.md\` |

\`\`\`bash
mkdir -p <skill-dir>/docs-ssh
ssh -p $PORT docs@$HOST agents skill > <skill-dir>/docs-ssh/SKILL.md
\`\`\`

## Option 4: Both tools + skill (best coverage)

\`\`\`bash
# Custom tools (OpenCode only)
mkdir -p .opencode/tools
ssh -p $PORT docs@$HOST tools > .opencode/tools/docs.ts

# Agent instructions
ssh -p $PORT docs@$HOST agents >> AGENTS.md

# On-demand skill
mkdir -p .opencode/skills/docs-ssh
ssh -p $PORT docs@$HOST agents skill > .opencode/skills/docs-ssh/SKILL.md
\`\`\`

## Verify it works

\`\`\`bash
ssh -o StrictHostKeyChecking=no -p $PORT docs@$HOST "ls /docs/"
\`\`\`

Please run option 1 (custom tools + AGENTS.md) now. Or if you're using Claude Code, run option 2 with \`agents claude\`.
EOF
