# docs-ssh

Self-hosted SSH docs server serving Supabase, Cloudflare, Vercel, PostgreSQL, and AWS documentation — plus blogs and changelogs. Designed for AI agents.

```bash
ssh -p 2222 docs@docs.erfi.io "grep -rl 'RLS' /docs/"
ssh -p 2222 docs@docs.erfi.io "cat /docs/supabase/guides/auth.md"
ssh -p 2222 docs@docs.erfi.io "find /docs/cloudflare -name '*.md' -path '*workers*'"
ssh -p 2222 docs@docs.erfi.io "head -20 /docs/aws/lambda/latest/dg/welcome.html"
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
│   ├── MdxNormaliser.ts   # Strips MDX/JSX → clean markdown
│   └── HtmlNormaliser.ts  # Converts HTML → markdown via Turndown
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
| Supabase Blog | http | sitemap | html | `sitemap_www.xml` |
| Cloudflare | http | llms-full | markdown | 40MB full dump from `llms-full.txt` |
| Cloudflare Blog | http | sitemap | html | `sitemap-posts.xml` |
| Vercel | http | llms-full | markdown | 11MB full dump from `llms-full.txt` |
| Vercel Blog | http | sitemap | html | `sitemap.xml` filtered to `/blog/` |
| Vercel Changelog | http | sitemap | html | `sitemap.xml` filtered to `/changelog/` |
| PostgreSQL | http | toc | html → md | All pages from `bookindex.html` |
| AWS | http | llms-index | html | Per-service `llms.txt` for 20 core services |

## Running locally

```bash
pnpm install
pnpm fetch-docs     # fetches all docs into ./docs/
docker compose up    # serves on port 2222
```

## Production (Dockge)

```bash
docker compose -f compose.prod.yaml up -d
```

Uses `ghcr.io/erfianugrah/docs-ssh:latest`, runs on `172.19.50.2:2222` behind Caddy L4 proxy.

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + unit tests |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, build & push Docker image as `latest` + datestamp |
| `release.yml` | tags `v*` | build & push Docker image with semver tags |

## Development

```bash
pnpm test           # run all unit tests
pnpm test:watch     # watch mode
pnpm test:coverage  # with coverage report
pnpm test:e2e       # Docker-based smoke tests
pnpm lint           # typecheck only
```
