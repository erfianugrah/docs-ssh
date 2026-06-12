# docs-ssh

Self-hosted SSH docs server for AI agents. Serves 200+ documentation sources — including Supabase, Cloudflare, Vercel, AWS, Docker, Kubernetes, Next.js, React, PostgreSQL, Terraform, MDN, Pi, and more — plus blogs, changelogs, and OpenAPI specs as a searchable markdown filesystem over SSH. See `src/application/sources.ts` for the full list.

## Get started

```bash
docker run -d -p 2222:2222 ghcr.io/YOUR_USER/docs-ssh:latest
```

Then set up your agent. Pick the path for your tool:

### Pi

`tools pi` generates a Pi extension (TypeBox / `@earendil-works/pi-coding-agent`). No extra dependencies — Pi ships the required packages.

```bash
# Global install (all projects)
ssh -p 2222 docs@localhost tools pi > ~/.pi/agent/extensions/docs.ts

# Add agent instructions to Pi's global AGENTS.md
ssh -p 2222 docs@localhost agents pi >> ~/.pi/agent/AGENTS.md

# Optional: on-demand skill
mkdir -p ~/.pi/agent/skills/docs-ssh
ssh -p 2222 docs@localhost agents skill > ~/.pi/agent/skills/docs-ssh/SKILL.md
```

### OpenCode

`tools` generates an OpenCode custom tools file (Zod). Requires `zod` in your project.

```bash
mkdir -p .opencode/tools
ssh -p 2222 docs@localhost tools > .opencode/tools/docs.ts
npm install --save-dev zod

# Add agent instructions
ssh -p 2222 docs@localhost agents opencode >> AGENTS.md

# Optional: on-demand skill
mkdir -p .opencode/skills/docs-ssh
ssh -p 2222 docs@localhost agents skill > .opencode/skills/docs-ssh/SKILL.md
```

### Claude Code / Cursor / Gemini

No custom tools needed — the agent uses its Bash tool to run SSH commands directly.

```bash
ssh -p 2222 docs@localhost agents claude  >> CLAUDE.md
ssh -p 2222 docs@localhost agents cursor  >> .cursorrules
ssh -p 2222 docs@localhost agents gemini  >> GEMINI.md
```

### Not sure? Let the agent decide

```bash
ssh -p 2222 docs@localhost setup | opencode   # or | pi / | claude
```

The `setup` command outputs a structured guide that your agent will read and execute the right steps for your tool.

---

Search and read docs directly:

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
| `sources` | List all doc sets with file counts |
| `agents` | Agent instructions — raw SSH patterns (any agent) |
| `agents pi` | Pi format — references `docs_*` extension tools |
| `agents opencode` | OpenCode format — references `docs_*` custom tools |
| `agents claude` | CLAUDE.md format with header |
| `agents cursor` | .cursorrules format |
| `agents gemini` | GEMINI.md format with header |
| `agents skill` | SKILL.md with YAML frontmatter (on-demand skill) |
| `agents help` | Show all available output formats |
| `tools` | OpenCode custom tools file (TypeScript / Zod) |
| `tools pi` | Pi extension file (TypeScript / TypeBox) |
| `tools help` | Show tools format options |
| `setup` | Interactive setup guide (pipe to your agent) |

## What `tools` and `tools pi` generate

Both commands output a **TypeScript file you save locally** — no code is executed during the install. The file implements the docs tools (docs_search, docs_read, docs_grep, docs_find, docs_summary, docs_sources) as thin wrappers around SSH commands to the docs server.

- `tools` → OpenCode custom tools format (Zod schemas, `.opencode/tools/docs.ts`)
- `tools pi` → Pi extension format (TypeBox, `~/.pi/agent/extensions/docs.ts`)

The generated file contains only the SSH connection constants (host, port) and the tool logic. You can inspect it before saving:

```bash
ssh -p 2222 docs@localhost tools pi | head -30     # preview the pi extension
ssh -p 2222 docs@localhost tools    | head -30     # preview the opencode tools
```

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

200+ sources covering programming languages, frameworks, databases, cloud platforms, and developer tooling. Full canonical list lives in [`src/application/sources.ts`](src/application/sources.ts); the live server reports counts via:

```bash
ssh -p 2222 docs@docs.erfi.io sources
```

Sources are fetched using the most reliable mechanism the upstream offers, in this preference order (most → least durable):

| Mechanism | Count | Notes |
|-----------|-------|-------|
| **git sparse-checkout** | ~83 | Clone the upstream's docs directory. Markdown direct from source. |
| **bulk archive** | 1 | Single `.tar.gz` (Supabase publishes one). |
| **`llms-full.txt`** | ~12 | AI-targeted single-file dump (Cloudflare, Vercel, Next.js, Bitwarden, etc.). |
| **OpenAPI spec** | ~10 | Converted to per-endpoint-group markdown at ingestion time. |
| **per-page HTML scrape** | ~30 | Last resort — sitemap, llms-index, toc, rss, mediawiki. |

### API reference sources

OpenAPI specs are converted to per-tag markdown at ingestion time. Each output dir has `api/overview.md` (endpoint index) plus one file per tag/group.

Live: `aws-api`, `authentik-api`, `cloudflare-api`, `docker-api`, `flyio-api`, `gitea-api`, `keycloak-api`, `kubernetes-api`, `supabase-api`, `supabase-auth-api`.

## Build from source

```bash
git clone https://github.com/YOUR_USER/docs-ssh
cd docs-ssh
pnpm install
pnpm fetch-docs            # fetches all docs into ./docs/ (parallel, cached)
docker compose up           # serves on port 2222 (uses docker-compose.yml)

# Or build a self-contained image:
pnpm docker:build           # force-refresh docs + docker build
pnpm docker:build:cached    # use cached docs (fastest for iterating)
```

## Production deployment

**Docker Compose** — use `compose.prod.yaml`:

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
pnpm test            # unit tests (vitest)
pnpm test:e2e        # Docker-based E2E tests (requires Docker)
pnpm test:smoke      # smoke tests against live server (DOCS_SSH_HOST=docs.erfi.io)
pnpm test:bench      # token efficiency benchmark (requires live server)
pnpm test:coverage   # with coverage report
pnpm lint            # typecheck only
pnpm generate:tools  # regenerate commands/tools.sh + commands/tools-pi.sh

# Release (bumps package.json, commits, tags, pushes — triggers release workflow)
pnpm release:patch   # 0.8.3 → 0.8.4
pnpm release:minor   # 0.8.4 → 0.9.0
pnpm release:major   # 0.9.0 → 1.0.0
```
