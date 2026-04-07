# docs-ssh

Self-hosted SSH docs server serving Supabase, Cloudflare, Vercel, PostgreSQL, and AWS documentation — plus blogs and changelogs. Designed for AI agents.

```bash
ssh -p 2222 docs@localhost "grep -rl 'RLS' /docs/"
ssh -p 2222 docs@localhost "cat /docs/supabase/guides/auth.md"
ssh -p 2222 docs@localhost "find /docs/cloudflare -name '*.md' -path '*workers*'"
ssh -p 2222 docs@localhost "head -20 /docs/aws/lambda/latest/dg/welcome.md"
```

## Quick start

```bash
git clone https://github.com/YOUR_USER/docs-ssh
cd docs-ssh
pnpm install
pnpm fetch-docs     # fetches all docs into ./docs/
docker compose up    # serves on port 2222
```

## Architecture

```
src/
├── domain/              # Core domain — entities, value objects, ports
│   ├── DocSource.ts     # Value object: a documentation source
│   ├── DocFile.ts       # Value object: a single doc file
│   ├── DocSet.ts        # Entity: a fetched collection of doc files
│   ├── DocIngestor.ts   # Port: interface for fetching a DocSource
│   └── DocNormaliser.ts # Port: interface for converting to markdown
├── ingestors/
│   ├── GitIngestor.ts     # Fetches markdown/MDX from git repos (sparse checkout)
│   ├── HttpIngestor.ts    # Fetches pages over HTTP (sitemap, tarball, llms, toc)
│   └── llms-splitter.ts   # Splits llms-full.txt into per-page files
├── normaliser/
│   ├── MdxNormaliser.ts     # Strips MDX/JSX → clean markdown
│   ├── HtmlNormaliser.ts    # Converts HTML → markdown via Turndown
│   ├── MarkdownCleaner.ts   # Strips nav boilerplate from llms-full pages
│   └── ContentSanitiser.ts  # Strips ANSI escapes, null bytes, path traversal
├── application/
│   ├── sources.ts         # Canonical source definitions
│   └── UpdateDocSets.ts   # Orchestrates ingest → normalise → write
└── index.ts               # CLI entrypoint
```

## Doc sources

Each source uses the best available fetch method — no hardcoded URL lists.

| Source | Type | Discovery | Format | Notes |
|--------|------|-----------|--------|-------|
| Supabase | http | tarball | markdown | `docs.tar.gz` — same as supabase.sh |
| Cloudflare | http | llms-full | markdown | 40MB full dump from `llms-full.txt` |
| Cloudflare Blog | http | sitemap | html → md | `sitemap-posts.xml` |
| Vercel | http | llms-full | markdown | 11MB full dump from `llms-full.txt` |
| Vercel Blog | http | sitemap | markdown | `.md` suffix per page |
| Vercel Changelog | http | sitemap | markdown | `.md` suffix per page |
| PostgreSQL | http | toc | html → md | All pages from `bookindex.html` |
| AWS | http | llms-index | html → md | Per-service `llms.txt` for core services |

## Production deployment

Copy `compose.prod.yaml`, adjust the image reference and network settings for your environment:

```bash
docker compose -f compose.prod.yaml up -d
```

The container:
- Runs as non-root (`docs` user) with read-only filesystem
- Drops all capabilities except those required by sshd
- Generates unique SSH host keys at runtime (not baked into image)
- Logs all commands as structured JSON to Docker logs
- Accepts passwordless SSH (by design — public docs, like supabase.sh)

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + unit tests |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, build & push Docker image as `latest` + datestamp |
| `release.yml` | tags `v*` | build & push Docker image with semver tags |

## Security

- **Read-only filesystem** — docs cannot be modified at runtime
- **Capability-restricted** — only CHOWN, SETUID, SETGID, SYS_CHROOT, AUDIT_WRITE
- **no-new-privileges** — processes cannot gain additional privileges
- **Content sanitised** — ANSI escape sequences, null bytes, control characters stripped at ingest time
- **Path traversal prevented** — `..` stripped from all file paths during ingest
- **Passwordless by design** — this serves public documentation, same model as supabase.sh

## Development

```bash
pnpm test           # run all unit tests (70 tests)
pnpm test:watch     # watch mode
pnpm test:coverage  # with coverage report
pnpm test:e2e       # Docker-based smoke tests
pnpm lint           # typecheck only
```
