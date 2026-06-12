#!/bin/sh
# Interactive setup guide — pipe to your agent for guided configuration.
# Usage: ssh -p 2222 docs@HOST setup | opencode
#        ssh -p 2222 docs@HOST setup | claude
#        ssh -p 2222 docs@HOST setup | pi

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

cat << EOF
# docs-ssh setup

I'm a documentation server with $(find /docs -mindepth 2 -type f | wc -l) searchable docs across $(ls -1 /docs/ | grep -v '^_' | wc -l) sources: $(ls -1 /docs/ | grep -v '^_' | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g').

Please set me up in this project. Here's what to do:

## Option 1: Pi extension (recommended for Pi users)

Install the Pi extension so docs_search, docs_read, docs_find, docs_grep, docs_summary, and docs_sources become first-class Pi tools with TypeBox parameters and structured return values:

\`\`\`bash
# Global (all projects)
ssh -p $PORT docs@$HOST tools pi > ~/.pi/agent/extensions/docs.ts

# Add agent instructions to Pi's global AGENTS.md
ssh -p $PORT docs@$HOST agents pi >> ~/.pi/agent/AGENTS.md
\`\`\`

No extra dependencies — uses \`@earendil-works/pi-ai\` and \`@earendil-works/pi-coding-agent\`, which Pi ships with.

## Option 2: OpenCode custom tools

Install the OpenCode custom tools file so the LLM gets docs_search, docs_read, docs_find, docs_grep, docs_summary, and docs_sources as first-class tools. The grep tool uses \`rg --json\` for structured results with exact line numbers, and the read tool uses \`bat\` for line-numbered output:

\`\`\`bash
mkdir -p .opencode/tools
ssh -p $PORT docs@$HOST tools > .opencode/tools/docs.ts
\`\`\`

Then add the OpenCode-specific agent instructions:

\`\`\`bash
ssh -p $PORT docs@$HOST agents opencode >> AGENTS.md
\`\`\`

Make sure \`zod\` is installed (the tools file needs it):

\`\`\`bash
npm install --save-dev zod
\`\`\`

## Option 3: Append agent instructions to your rules file

If you don't want custom tools, just add SSH instructions. The \`agents\` command accepts a format argument:

| Tool | Command |
|------|---------|
| Pi | \`ssh -p $PORT docs@$HOST agents pi >> ~/.pi/agent/AGENTS.md\` |
| OpenCode / Copilot | \`ssh -p $PORT docs@$HOST agents >> AGENTS.md\` |
| Claude Code | \`ssh -p $PORT docs@$HOST agents claude >> CLAUDE.md\` |
| Cursor | \`ssh -p $PORT docs@$HOST agents cursor >> .cursorrules\` |
| Gemini CLI | \`ssh -p $PORT docs@$HOST agents gemini >> GEMINI.md\` |

The agent will use its Bash tool to run SSH commands directly. Available tools on the server: rg (ripgrep, supports --json), bat (syntax-aware cat with line numbers), find, cat, head, tail, tree, wc.

## Option 4: Install as an on-demand skill

Skills are loaded on demand. Pick the path for your tool:

| Tool | Skill path |
|------|-----------|
| Pi (global) | \`~/.pi/agent/skills/docs-ssh/SKILL.md\` |
| Pi (project) | \`.pi/skills/docs-ssh/SKILL.md\` |
| OpenCode | \`.opencode/skills/docs-ssh/SKILL.md\` |
| Claude Code | \`.claude/skills/docs-ssh/SKILL.md\` |
| Cross-client | \`.agents/skills/docs-ssh/SKILL.md\` |

\`\`\`bash
mkdir -p <skill-dir>/docs-ssh
ssh -p $PORT docs@$HOST agents skill > <skill-dir>/docs-ssh/SKILL.md
\`\`\`

## Option 5: Full setup (extension + AGENTS.md + skill)

\`\`\`bash
# Pi extension (TypeBox)
ssh -p $PORT docs@$HOST tools pi > ~/.pi/agent/extensions/docs.ts

# Agent instructions
ssh -p $PORT docs@$HOST agents pi >> ~/.pi/agent/AGENTS.md

# On-demand skill (project-scoped)
mkdir -p .pi/skills/docs-ssh
ssh -p $PORT docs@$HOST agents skill > .pi/skills/docs-ssh/SKILL.md
\`\`\`

## Verify it works

\`\`\`bash
ssh -o StrictHostKeyChecking=no -p $PORT docs@$HOST "ls /docs/"
\`\`\`

Please run option 1 (Pi extension + AGENTS.md) if you are using Pi, or option 2 (OpenCode custom tools) if you are using OpenCode. For Claude Code run option 3 with \`agents claude\`.
EOF
