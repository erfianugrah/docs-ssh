#!/bin/sh
# Dynamic help — uses env vars so HOST and PORT are correct in production.

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"

cat << EOF
docs-ssh — documentation over SSH for AI agents

Usage:
  ssh -p $PORT docs@$HOST <command>

Built-in commands:
  help          Show this help
  sources       List available doc sets and file counts
  agents        Output AGENTS.md snippet (append to your rules file)
  tools         Output OpenCode custom tools file (save as .opencode/tools/docs.ts)
  setup         Interactive setup guide (pipe to your agent: ssh ... setup | opencode)

Search & read:
  grep -rl 'query' /docs/          Search across all docs
  cat /docs/supabase/guides/auth.md  Read a specific file
  find /docs/vercel -name '*.md'   Find files by pattern
  head -20 /docs/postgres/indexes.md  Skim a file

Examples:
  ssh -p $PORT docs@$HOST agents >> AGENTS.md
  ssh -p $PORT docs@$HOST tools > .opencode/tools/docs.ts
  ssh -p $PORT docs@$HOST setup | opencode
  ssh -p $PORT docs@$HOST "grep -rl 'RLS' /docs/supabase/"
EOF
