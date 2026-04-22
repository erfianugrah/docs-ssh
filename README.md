# docs-ssh

Self-hosted SSH docs server for AI agents. Serves 100+ documentation sources — including Supabase, Cloudflare, Vercel, AWS, Docker, Kubernetes, Next.js, React, PostgreSQL, Terraform, MDN, OpenCode, and more — plus blogs, changelogs, and OpenAPI specs as a searchable markdown filesystem over SSH. See `src/application/sources.ts` for the full list.

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
| MDN Web Docs | git sparse | markdown | 14,000+ pages — HTML, CSS, JS, HTTP, Web APIs |
| Gitea | sitemap | html → md | Self-hosted Git forge docs (unversioned latest) |
| Authentik | git sparse | mdx → md | Identity provider docs from `goauthentik/authentik` |
| Keycloak | sitemap | html → md | OIDC/SAML IdP guides (server, HA, securing apps) |
| OpenID | explicit | html → md | OIDC specs and developer docs from `openid.net` |
| Terraform | git sparse | mdx → md | IaC docs from `hashicorp/web-unified-docs` (all versions) |
| Zsh | toc | html → md | Full manual (28 chapters) from `zsh.sourceforge.io` |
| Oh My Zsh | git | markdown | Curated wiki (FAQ, plugins, themes, customization) |
| Zinit | git sparse | mdx → md | Guides, syntax, annexes, ecosystem from `z-shell/wiki` |
| Powerlevel10k | git | markdown | Comprehensive README (105KB) from `romkatv/powerlevel10k` |
| WezTerm | git sparse | markdown | 634 doc files from `wezterm/wezterm` |
| SOPS | sitemap | html → md | Secrets management docs from `getsops.io` |
| age | git | markdown | File encryption tool from `FiloSottile/age` |
| tmux | git (wiki) | markdown | Terminal multiplexer guides from `tmux/tmux` wiki |
| OpenCode | sitemap | html → md | AI coding agent docs from `opencode.ai` |
| Vitest | llms-full | markdown | Testing framework docs (~1.1MB) |
| Vite | llms-full | markdown | Build tool docs (~350KB) |
| Turborepo | llms-txt | html → md | Monorepo build system (~130 entries) |
| Deno | llms-full | markdown | Runtime docs (~2MB) |
| Svelte/SvelteKit | llms-full | markdown | Both frameworks in one dump (~1MB) |
| TanStack | llms-txt | html → md | Query, Router, Table, Form, and more |
| Prettier | llms-txt | html → md | Code formatter docs (~23 pages) |
| ESLint | sitemap | html → md | Linting rules, config, plugins |
| SQLite | toc | html → md | All docs from table-of-contents page |
| Prometheus | sitemap | html → md | Monitoring system docs |
| OpenTelemetry | llms-txt | html → md | Observability standard (concepts, SDK guides) |
| Rspack | llms-txt | html → md | Rust-based bundler (~100 entries) |
| Effect | llms-txt | html → md | TypeScript effect system |
| Argo CD | sitemap | html → md | GitOps CD for Kubernetes (~180 pages) |
| Helm | sitemap | html → md | Kubernetes package manager |
| mise | sitemap | html → md | Polyglot dev tool manager (~170 pages) |
| pnpm | sitemap | html → md | Package manager (CLI + config reference) |
| Resend | llms-txt | html → md | Email API for developers (~200 entries) |
| Let's Encrypt | sitemap-index | html → md | TLS CA docs (English) |
| rclone | sitemap | html → md | Cloud storage sync tool (~130 pages) |
| Redis | sitemap | html → md | In-memory data store docs |
| Grafana | sitemap-index | html → md | Observability platform docs |
| GitLab | sitemap-index | html → md | DevSecOps platform docs |
| GitHub Docs | git sparse | markdown | Full docs from `github/docs` repo |
| Playwright | sitemap | html → md | Browser testing framework |
| FastAPI | sitemap | html → md | Python web framework (~130 pages) |
| Go | toc | html → md | Core docs (tutorials, effective go, modules) |
| WireGuard | sitemap | html → md | VPN tunnel docs (~18 pages, dense) |
| Nix | sitemap | html → md | nix.dev community docs (~57 pages) |
| React Native | llms-full | markdown | Mobile framework docs (~2MB) |
| Flutter | llms-txt | html → md | Cross-platform UI toolkit (~100 pages) |
| Expo | llms-txt | html → md | React Native framework (EAS, Router, modules) |
| Tauri | llms-txt | html → md | Rust+Web desktop/mobile app framework |
| htmx | sitemap | html → md | HTML-driven interactivity |
| Jest | sitemap | html → md | JavaScript testing framework |
| Cypress | sitemap | html → md | E2E testing framework |
| Wails | sitemap | html → md | Go+Web desktop apps |
| Prisma | llms-txt | html → md | TypeScript ORM (~300+ entries) |
| SST | llms-txt | html → md | Infrastructure framework (AWS, CF, Vercel) |
| Valkey | git sparse | markdown | Redis fork docs (topics + commands) |
| Bitwarden | sitemap | markdown | Help docs (~350 pages, `.md` suffix) |
| Vaultwarden | git (wiki) | markdown | Self-hosted Bitwarden server (65 pages) |
| curl | git | markdown | "Everything curl" book (~170 files) |
| ripgrep | git | markdown | GUIDE.md + FAQ.md (~100KB) |
| HTTPie | git sparse | markdown | CLI docs from `httpie/cli` repo |
| GraphQL Spec | git sparse | markdown | Official spec (12 files) |
| GraphQL Docs | git sparse | mdx → md | Learn guides, FAQ, graphql-js reference |

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
| Gitea API | Swagger 2.0 | 819 KB | 10 files |
| Authentik API | OpenAPI 3.0 | 1.6 MB | 26 files |
| Keycloak Admin API | OpenAPI 3.0 | 360 KB | 23 files |

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
