# docs-ssh

Self-hosted SSH docs server for AI agents. Serves 42 documentation sources — Supabase, Cloudflare, Vercel, AWS, Docker, Kubernetes, Next.js, React, Bun, Hono, Zod, Drizzle, TypeScript, Python, Ansible, PostgreSQL, Astro, Fly.io, Traefik, Caddy, Neovim, Tailwind CSS, Rust, MCP, Mermaid, D2, Shadcn, K3s, Starlight — plus blogs, changelogs, and OpenAPI specs for Cloudflare, Docker, Kubernetes, Supabase, and Fly.io — as a searchable markdown filesystem over SSH.

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

Output is capped at 16K chars (~4K tokens) with a truncation pointer — informed by Claude Code's context management patterns where oversized tool results trigger microcompaction.

## Doc sources

Each source uses the best available fetch method — no hardcoded URL lists.

| Source | Discovery | Format | Notes |
|--------|-----------|--------|-------|
| Supabase | tarball | markdown | `docs.tar.gz` — same as supabase.sh |
| Supabase Blog | git sparse | mdx → md | 400 posts from `supabase/supabase` repo |
| Cloudflare | llms-full | markdown | 40MB dump from `llms-full.txt` |
| Cloudflare Blog | sitemap | html → md | 3,400+ posts from `sitemap-posts.xml` |
| Cloudflare Changelog | rss | html → md | Full history from RSS feed |
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
| Docker | llms-txt | html → md | 1,400+ pages from `llms.txt` |
| Shadcn/UI | llms-txt | html → md | Component docs from `llms.txt` |
| Kubernetes | git sparse | markdown | Full docs from `kubernetes/website` |
| Traefik | git sparse | markdown | Docs from `traefik/traefik` repo |
| Caddy | git sparse | markdown | Docs from `caddyserver/website` repo |
| Neovim | sitemap | html → md | Help docs from `neovim.io/doc/user/` |
| Starlight | sitemap | html → md | Astro's Starlight framework docs |
| Mermaid | git sparse | markdown | Diagram syntax from `mermaid-js/mermaid` |
| D2 | sitemap | html → md | Diagramming language tour + examples |
| Bun | llms-txt | markdown | 315 pages with `.md` URLs |
| React | llms-txt | markdown | Full React docs with `.md` URLs |
| Hono | llms-txt | html → md | CF Workers + Bun web framework |
| Zod | llms-txt | html → md | TypeScript schema validation |
| Drizzle ORM | llms-txt | html → md | TypeScript ORM for Postgres/MySQL/SQLite |
| TypeScript | git sparse | markdown | Handbook + reference from `TypeScript-Website` |
| K3s | sitemap | html → md | Lightweight Kubernetes docs |
| Python | toc | html → md | Tutorial, library, reference, howto, FAQ |
| Ansible | toc | html → md | Playbooks, inventory, vault, modules, dev guide |
| Erfi Technical Blog | git sparse | mdx → md | Technical docs from `erfianugrah/lexicanum` |
| Erfi Personal Blog | git sparse | mdx → md | Photography & writing from `erfianugrah/revista-3` |

### OpenAPI specs

Converted to per-endpoint-group markdown at ingestion time (4-8x compression vs raw JSON/YAML).

| Source | Spec format | Raw size | Output |
|--------|-------------|----------|--------|
| Cloudflare API | OpenAPI 3.x | 9 MB | 456 files, 1.9 MB |
| Docker Engine API | Swagger 2.0 | 456 KB | 16 files, 73 KB |
| Kubernetes API | Swagger 2.0 | 4 MB | 65 files, 727 KB |
| Supabase Management API | OpenAPI 3.0 | 455 KB | 17 files, 62 KB |
| Supabase Auth API | OpenAPI 3.0 | 132 KB | 9 files, 38 KB |
| Fly.io Machines API | Swagger 2.0 | 203 KB | 9 files, 26 KB |

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

- **Post-quantum key exchange** — sntrup761x25519 KEX, chacha20-poly1305/AES-256-GCM ciphers, ETM-only MACs
- **Read-only filesystem** — docs cannot be modified at runtime
- **Capability-restricted** — `cap_drop: ALL`, adds back only CHOWN/SETUID/SETGID/SYS_CHROOT/AUDIT_WRITE
- **no-new-privileges** — processes cannot escalate
- **Runtime host keys** — ed25519 + RSA generated at startup, not baked into the image
- **Content sanitised** — ANSI escapes, null bytes, control characters stripped at ingest
- **Path traversal prevented** — `..` stripped from all paths during ingest
- **Output capped** — 16K char limit prevents context window exhaustion
- **Structured audit logging** — every command logged as JSON to Docker logs with cache status
- **Passwordless by design** — serves public documentation, same model as supabase.sh

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + 171 unit tests |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, build & push Docker image |
| `release.yml` | tags `v*` | build & push with semver tags |

## Development

```bash
pnpm test           # 171 unit tests
pnpm test:e2e       # 52 Docker-based E2E tests
pnpm test:bench     # token efficiency benchmark (requires live server)
pnpm test:coverage  # with coverage report
pnpm lint           # typecheck only
pnpm generate:tools # regenerate commands/tools.sh from TypeScript template
```
