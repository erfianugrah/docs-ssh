# AGENTS.md

## What this is

SSH docs server that serves 18 documentation sources as a searchable markdown filesystem over SSH. The Node.js codebase fetches, normalises, and writes docs; a Docker image serves them via OpenSSH with `ForceCommand` routing.

## Commands

```bash
pnpm install              # Node 22+, pnpm 10
pnpm lint                 # typecheck only (tsc --noEmit)
pnpm test                 # 141 unit tests (vitest, tests/unit/)
pnpm test:e2e             # Docker-based E2E (builds image, starts container, SSH tests)
pnpm test:coverage        # unit tests with v8 coverage
pnpm fetch-docs           # fetch all 18 doc sources into ./docs/ (network-heavy, slow)
pnpm docker:build         # fetch-docs + docker build in one step
```

CI runs `pnpm lint` then `pnpm test:coverage`. Match that order locally.

## Architecture

```
src/
  index.ts              — entrypoint for fetch-docs (not the SSH server)
  domain/               — value objects + port interfaces (DocSource, DocIngestor, DocNormaliser)
  application/          — UpdateDocSets orchestrator, sources.ts (all 18 source definitions)
  ingestors/            — GitIngestor (sparse clone), HttpIngestor (tarball/llms-full/sitemap/toc)
  normaliser/           — MDX→MD, HTML→MD (turndown), markdown cleanup, content sanitiser
  shared/               — walkDir utility
commands/               — shell scripts for SSH built-in commands (help, sources, agents, tools, setup)
```

- `src/application/sources.ts` is the canonical list of all doc sources. Each uses a discovery method (tarball, llms-full, sitemap, toc, llms-index, llms-txt, git sparse).
- Domain layer uses ports-and-adapters: `DocIngestor` and `DocNormaliser` are interfaces; implementations are in `ingestors/` and `normaliser/`.
- `docs/` is gitignored — generated at build time by `pnpm fetch-docs` or during Docker build.

## Docker / SSH runtime

- The Docker image has two stages: fetcher (Node, fetches docs) and runtime (Alpine + OpenSSH + ripgrep + jq).
- `entrypoint.sh` generates host keys at startup, starts busybox httpd on 8080, runs sshd on 2222.
- `log-cmd.sh` is the `ForceCommand` — routes built-in commands (`help`, `sources`, `agents`, `tools`, `setup`) and logs all exec as JSONL.
- `sshd_config`: passwordless access, `AllowUsers docs`, read-only filesystem, `ForceCommand /usr/local/bin/log-cmd`.
- `build-index.sh` creates `/docs/_index.tsv` (path + title + summary per file) at image build time.

## Testing

- **Unit tests** (`tests/unit/`): mirror `src/` structure. No network or Docker needed.
- **E2E tests** (`tests/e2e/smoke.test.ts`): build a Docker image with mock docs, start a container, run SSH commands against it. Require Docker. 3-minute timeout.
- **Benchmarks** (`tests/benchmark/`): token efficiency tests, require a live SSH server.
- Vitest with globals enabled. Three separate configs: `vitest.config.ts` (unit), `vitest.e2e.config.ts`, `vitest.bench.config.ts`.

## Env vars

| Variable | Used by | Default |
|----------|---------|---------|
| `DOCS_OUT_DIR` | fetch-docs | `./docs` |
| `DOCS_WORK_DIR` | fetch-docs | `$TMPDIR/docs-ssh-work` |
| `DOCS_SSH_HOST` | commands/*.sh | `localhost` |
| `DOCS_SSH_PORT` | commands/*.sh | `2222` |

## Adding a new doc source

Add a `new DocSource({...})` to `src/application/sources.ts`. Pick a discovery method that matches how the upstream provides docs. The ingestor and normaliser are selected automatically by type/format matching.
