# docs-ssh

Self-hosted SSH docs server serving Supabase, Cloudflare and Postgres documentation as a browsable markdown filesystem. Designed for AI agents.

```bash
ssh -p 2222 localhost grep -rl 'RLS' /docs/supabase/
ssh -p 2222 localhost cat /docs/cloudflare/workers/index.md
ssh -p 2222 localhost find /docs/postgres -name '*.md'
```

## Architecture

```
src/
├── domain/            # Core domain — entities, value objects, ports
│   ├── DocSource.ts   # Value object: a documentation source
│   ├── DocFile.ts     # Value object: a single doc file
│   ├── DocSet.ts      # Entity: a fetched collection of doc files
│   ├── DocIngestor.ts # Port: interface for fetching a DocSource
│   └── DocNormaliser.ts # Port: interface for converting to markdown
├── ingestors/
│   ├── GitIngestor.ts   # Fetches markdown/MDX from git repos (sparse checkout)
│   └── HttpIngestor.ts  # Fetches HTML pages over HTTP
├── normaliser/
│   ├── MdxNormaliser.ts # Strips MDX/JSX → clean markdown
│   └── HtmlNormaliser.ts # Converts HTML → markdown via Turndown
├── application/
│   ├── sources.ts       # Canonical source definitions
│   └── UpdateDocSets.ts # Orchestrates ingest → normalise → write
└── index.ts             # CLI entrypoint
```

## Doc sources

| Source | Type | Format | Notes |
|--------|------|--------|-------|
| Supabase | git | markdown | `supabase/supabase` sparse-checked out |
| Cloudflare | git | mdx → md | `cloudflare/cloudflare-docs` sparse-checked out |
| Postgres | http | html → md | Curated page list from postgresql.org |

## Running locally

```bash
pnpm install
pnpm fetch          # fetches all docs into ./docs/
docker compose up   # serves on port 2222
```

## CI workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | push / PR | typecheck + unit tests |
| `update-docs.yml` | daily 02:00 UTC + manual | fetch docs, commit if changed, trigger release |
| `release.yml` | tags `v*` + manual | build & push Docker image to ghcr.io |

## Development

```bash
pnpm test           # run all tests once
pnpm test:watch     # watch mode
pnpm test:coverage  # with coverage report
pnpm lint           # typecheck only
```
