# docs-ssh

Self-hosted SSH docs server for AI agents. Serves Supabase, Cloudflare, Vercel, PostgreSQL, AWS, Next.js, Astro, Fly.io, Tailwind CSS, Rust, and MCP documentation — plus blogs and changelogs — as a searchable markdown filesystem over SSH.

## Get started

```bash
docker run -d -p 2222:2222 ghcr.io/YOUR_USER/docs-ssh:latest
```

Then set up your agent with one command:

```bash
# OpenCode: install custom tools + rules
ssh -p 2222 docs@localhost tools > .opencode/tools/docs.ts
ssh -p 2222 docs@localhost agents >> AGENTS.md

# Or pipe the interactive setup guide to your agent
ssh -p 2222 docs@localhost setup | opencode
```

Search and read docs:

```bash
ssh -p 2222 docs@localhost "grep -rl 'RLS' /docs/"
ssh -p 2222 docs@localhost "cat /docs/supabase/guides/auth.md"
ssh -p 2222 docs@localhost "find /docs/cloudflare -name '*.md' -path '*workers*'"
```

## Built-in commands

| Command | What it does |
|---------|-------------|
| `help` | Show usage and available commands |
| `sources` | List all doc sets with file counts |
| `agents` | Output AGENTS.md snippet (append to your rules file) |
| `tools` | Output OpenCode custom tools file (save as `.opencode/tools/docs.ts`) |
| `setup` | Interactive setup guide (pipe to your agent) |

## Token efficiency

The tools use a search → summary → targeted read workflow that's **80% more token-efficient** than MCP tools for the same queries:

| Approach | Tokens | vs MCP |
|----------|--------|--------|
| `docs_search` (file paths) | ~480 | 98% smaller |
| `docs_summary` (headings) | ~200 | n/a |
| `docs_grep` (targeted) | ~1,500 | 77% smaller |
| MCP search (full pages) | ~30,000 | baseline |

Output is capped at 16K chars (~4K tokens) with a truncation pointer — informed by Claude Code's context management patterns where oversized tool results trigger microcompaction.

## Doc sources

Each source uses the best available fetch method — no hardcoded URL lists.

| Source | Discovery | Format | Notes |
|--------|-----------|--------|-------|
| Supabase | tarball | markdown | `docs.tar.gz` — same as supabase.sh |
| Supabase Blog | git sparse | mdx → md | 400 posts from `supabase/supabase` repo |
| Cloudflare | llms-full | markdown | 40MB dump from `llms-full.txt` |
| Cloudflare Blog | sitemap | html → md | 3,400+ posts from `sitemap-posts.xml` |
| Vercel | llms-full | markdown | 11MB dump from `llms-full.txt` |
| Vercel Blog | sitemap | markdown | `.md` suffix per page |
| Vercel Changelog | sitemap | markdown | `.md` suffix per page |
| PostgreSQL | toc | html → md | All pages from `bookindex.html` |
| AWS | llms-index | html → md | 20 core services via per-service `llms.txt` |
| Next.js | llms-full | markdown | Full docs from `llms-full.txt` |
| Astro | llms-full | markdown | Full docs from `llms-full.txt` |
| MCP | llms-txt | markdown | Per-page URLs from `llms.txt` |
| Fly.io | sitemap | html → md | `/docs/` pages filtered from sitemap |
| Tailwind CSS | git sparse | mdx → md | MDX docs from `tailwindcss.com` repo |
| Rust Book | git sparse | markdown | The Rust Programming Language |
| Erfi Technical Blog | git sparse | mdx → md | Technical docs from `erfianugrah/lexicanum` |
| Erfi Personal Blog | git sparse | mdx → md | Photography & writing from `erfianugrah/revista-3` |

## Build from source

```bash
git clone https://github.com/YOUR_USER/docs-ssh
cd docs-ssh
pnpm install
pnpm fetch-docs     # fetches all docs into ./docs/
docker compose up    # serves on port 2222
```

## Production deployment

**Docker Compose** — use `compose.prod.yaml`, adjust the image reference and network for your environment:

```bash
docker compose -f compose.prod.yaml up -d
```

**Fly.io** — see [`DEPLOY-FLY.md`](DEPLOY-FLY.md) for a complete guide. Quick start:

```bash
fly launch --no-deploy
fly ips allocate-v4          # required for raw TCP (SSH)
fly deploy
```

## Security

- **Read-only filesystem** — docs cannot be modified at runtime
- **Capability-restricted** — `cap_drop: ALL`, adds back only CHOWN/SETUID/SETGID/SYS_CHROOT/AUDIT_WRITE
- **no-new-privileges** — processes cannot escalate
- **Runtime host keys** — generated at startup, not baked into the image
- **Content sanitised** — ANSI escapes, null bytes, control characters stripped at ingest
- **Path traversal prevented** — `..` stripped from all paths during ingest
- **Output capped** — 16K char limit prevents context window exhaustion
- **Structured audit logging** — every command logged as JSON to Docker logs
- **Passwordless by design** — serves public documentation, same model as supabase.sh

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + 141 unit tests |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, build & push Docker image |
| `release.yml` | tags `v*` | build & push with semver tags |

## Development

```bash
pnpm test           # 141 unit tests
pnpm test:e2e       # 16 Docker-based E2E tests
pnpm test:bench     # token efficiency benchmark (requires live server)
pnpm test:coverage  # with coverage report
pnpm lint           # typecheck only
```
