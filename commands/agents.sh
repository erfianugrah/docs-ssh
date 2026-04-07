#!/bin/sh
# Generates AGENTS.md snippet dynamically based on available sources.
# Usage: ssh -p 2222 docs@HOST agents >> AGENTS.md

HOST="${DOCS_SSH_HOST:-localhost}"
PORT="${DOCS_SSH_PORT:-2222}"
USER="docs"

# Build the source list dynamically
SOURCES=$(ls -1 /docs/ | tr '\n' '  ')

cat << EOF
## Documentation

Before implementing features, check the docs via SSH. A docs server at \`$HOST\` serves documentation for $(ls -1 /docs/ | wc -l) sources as searchable markdown files.

\`\`\`bash
# List available doc sets
ssh -p $PORT $USER@$HOST "ls /docs/"
# → $SOURCES

# Search across all docs
ssh -p $PORT $USER@$HOST "grep -rl 'your query' /docs/"

# Read a specific guide
ssh -p $PORT $USER@$HOST "cat /docs/supabase/guides/auth.md"

# Find docs by path
ssh -p $PORT $USER@$HOST "find /docs/vercel -name '*.md' | head -20"

# Search with context
ssh -p $PORT $USER@$HOST "grep -A3 'partial index' /docs/postgres/indexes-partial.md"
\`\`\`

All docs live under \`/docs/{source}/\` as markdown files.
Use grep, find, cat, head, tail, and wc to search and read them.

For SSH options, add \`-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR\` to suppress host key warnings.
EOF
