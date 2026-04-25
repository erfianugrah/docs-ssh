# docs-ssh

Self-hosted SSH docs server for AI agents. Serves 130+ documentation sources — including Supabase, Cloudflare, Vercel, AWS, Docker, Kubernetes, Next.js, React, PostgreSQL, Terraform, MDN, OpenCode, and more — plus blogs, changelogs, and OpenAPI specs as a searchable markdown filesystem over SSH. See `src/application/sources.ts` for the full list.

## Get started

```bash
docker run -d -p 2222:2222 ghcr.io/YOUR_USER/docs-ssh:latest
```

Then set up your agent:

```bash
# OpenCode: custom tools + agent instructions
ssh -p 2222 docs@localhost tools > .opencode/tools/docs.ts
ssh -p 2222 docs@localhost agents >> AGENTS.md

# Claude Code
ssh -p 2222 docs@localhost agents claude >> CLAUDE.md

# Cursor / Gemini / any tool
ssh -p 2222 docs@localhost agents cursor >> .cursorrules
ssh -p 2222 docs@localhost agents gemini >> GEMINI.md

# On-demand skill (works with any tool)
mkdir -p .opencode/skills/docs-ssh
ssh -p 2222 docs@localhost agents skill > .opencode/skills/docs-ssh/SKILL.md

# Or pipe the interactive setup guide to your agent
ssh -p 2222 docs@localhost setup | opencode
```

Search and read docs:

```bash
ssh -p 2222 docs@localhost "rg -i 'RLS' /docs/supabase/"
ssh -p 2222 docs@localhost "bat --plain --paging=never /docs/supabase/guides/auth.md"
ssh -p 2222 docs@localhost "tree /docs/cloudflare/ -L 2"
ssh -p 2222 docs@localhost "rg --json 'auth' /docs/supabase/"
```

## Built-in commands

| Command | What it does |
|---------|-------------|
| `help` | Show usage and available commands |
| `sources` | List all doc sets with file counts (colorized in TTY) |
| `agents` | Output agent instructions — raw SSH patterns (any agent) |
| `agents opencode` | OpenCode format (references custom docs_* tools, not raw SSH) |
| `agents claude` | CLAUDE.md format with header |
| `agents cursor` | .cursorrules format |
| `agents gemini` | GEMINI.md format with header |
| `agents skill` | SKILL.md with YAML frontmatter (on-demand skill) |
| `agents help` | Show all available output formats |
| `tools` | Output OpenCode custom tools file (rg --json, bat, fallbacks) |
| `setup` | Interactive setup guide (pipe to your agent) |

## Token efficiency

The tools use a search → summary → targeted read workflow that's **80% more token-efficient** than MCP tools for the same queries:

| Approach | Tokens | vs MCP |
|----------|--------|--------|
| `docs_search` (file paths) | ~480 | 98% smaller |
| `docs_summary` (headings) | ~200 | n/a |
| `docs_grep` (targeted) | ~1,500 | 77% smaller |
| MCP search (full pages) | ~30,000 | baseline |

Output is capped at 51K chars (~12K tokens) with truncation hints that direct the agent to narrow its query or use offset/limit.

## Doc sources

138 sources covering programming languages, frameworks, databases, cloud platforms, and developer tooling. Full canonical list lives in [`src/application/sources.ts`](src/application/sources.ts); the live server reports counts via:

```bash
ssh -p 2222 docs@docs.erfi.io sources
```

Sources are fetched using the most reliable mechanism the upstream offers, in this preference order (most → least durable):

| Mechanism | Count | Notes |
|-----------|-------|-------|
| **git sparse-checkout** | ~83 | Clone the upstream's docs directory (e.g. `grafana/grafana/docs/sources`). Markdown direct from source — survives any HTML/JS/CSS rewrite. |
| **bulk archive** | 1 | Single `.tar.gz` (Supabase publishes one). |
| **`llms-full.txt`** | ~12 | AI-targeted single-file dump (Cloudflare, Vercel, Next.js, Bitwarden, etc.). |
| **OpenAPI spec** | ~10 | Converted to per-endpoint-group markdown at ingestion time (4-8× compression vs raw spec). |
| **per-page HTML scrape** (sitemap, llms-index, toc, rss, mediawiki) | ~30 | Last resort. Used only when the upstream offers no better option (e.g. AWS, postgres, python). |

The fetcher records each source's file count in a stamp file and refuses fetches that drop ≥50% — catches silent upstream-format regressions like AWS's 2026-04 `.html → .md` switch that quietly took the source from 10k+ files to 4.

### API reference sources

OpenAPI specs are converted to per-tag markdown at ingestion time. Each output dir has `api/overview.md` (endpoint index) plus one file per tag/group.

Live: `aws-api`, `authentik-api`, `cloudflare-api`, `docker-api`, `flyio-api`, `gitea-api`, `keycloak-api`, `kubernetes-api`, `supabase-api`, `supabase-auth-api`.

## Build from source

```bash
git clone https://github.com/YOUR_USER/docs-ssh
cd docs-ssh
pnpm install
pnpm fetch-docs           # fetches all docs into ./docs/ (parallel, cached)
docker compose up          # serves on port 2222

# Or build a self-contained image:
pnpm docker:build          # force-refresh docs + docker build
pnpm docker:build:cached   # use cached docs (fastest for iterating)
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

- **Post-quantum key exchange** — sntrup761x25519 KEX, chacha20-poly1305/AES-256-GCM ciphers, ETM-only MACs
- **Read-only filesystem** — docs cannot be modified at runtime
- **Capability-restricted** — `cap_drop: ALL`, adds back only CHOWN/SETUID/SETGID/SYS_CHROOT/AUDIT_WRITE
- **no-new-privileges** — processes cannot escalate
- **Runtime host keys** — ed25519 + RSA generated at startup, not baked into the image
- **Content sanitised** — ANSI escapes, null bytes, control characters stripped at ingest
- **Path traversal prevented** — `..` stripped from all paths during ingest
- **Output capped** — 51K char limit with truncation hints prevents context window exhaustion
- **Structured audit logging** — every command logged as JSON to Docker logs with cache status
- **Passwordless by design** — serves public documentation, same model as supabase.sh

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + unit tests with coverage |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, build & push Docker image |
| `release.yml` | tags `v*` | build & push with semver + latest tags, deploy to Composer |

## Development

```bash
pnpm test           # unit tests (vitest)
pnpm test:e2e       # Docker-based E2E tests (requires Docker)
pnpm test:smoke     # smoke tests against live server (DOCS_SSH_HOST=docs.erfi.io)
pnpm test:bench     # token efficiency benchmark (requires live server)
pnpm test:coverage  # with coverage report
pnpm lint           # typecheck only
pnpm generate:tools # regenerate commands/tools.sh from TypeScript template

# Release (bumps package.json, commits, tags, pushes — triggers release workflow)
pnpm release:patch  # 0.8.3 → 0.8.4
pnpm release:minor  # 0.8.4 → 0.9.0
pnpm release:major  # 0.9.0 → 1.0.0
```
