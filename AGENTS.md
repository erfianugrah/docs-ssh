# AGENTS.md

## What this is

SSH docs server — 130+ documentation sources (docs + API specs) served as searchable markdown over SSH. The source count is dynamic — `agents.sh` reads from the container at runtime. TypeScript fetcher normalises and writes docs; Docker image serves them via OpenSSH with `ForceCommand` routing. The two halves are separate: `src/` is the fetcher (Node.js/TypeScript), the SSH server is pure shell scripts + Docker.

## Commands

```bash
pnpm install              # Node 22+, pnpm 10
pnpm lint                 # typecheck only (tsc --noEmit)
pnpm test                 # unit tests (vitest, tests/unit/)
pnpm test:e2e             # Docker-based E2E tests (requires Docker, 3-min timeout)
pnpm test:smoke           # smoke tests against live container (DOCS_SSH_HOST=docs.erfi.io)
pnpm test:coverage        # unit tests with v8 coverage
pnpm generate:tools       # regenerate commands/tools.sh from TypeScript template
pnpm fetch-docs           # fetch all doc sources into ./docs/ (parallel, cached by default)
pnpm docker:build         # fetch-docs (force refresh) + docker build
pnpm docker:build:cached  # fetch-docs (use cache) + docker build — fastest for iterating
pnpm release:patch        # bump version, commit, tag, push (triggers release workflow)
pnpm release:minor        # same, minor bump
pnpm release:major        # same, major bump
```

Run a single test file: `npx vitest run tests/unit/path/to/test.ts` (not `pnpm test -- path` — that runs all tests).

CI runs `pnpm lint` then `pnpm test:coverage`. Match that order locally.

## Gotchas

- **ESM-only**: `"type": "module"` in package.json. All imports must use `.js` extensions (e.g. `import { Foo } from "./foo.js"`), even though source files are `.ts`.
- **tsx runtime**: scripts use `node --import tsx/esm`, not `ts-node` or compiled JS. No build step needed for dev.
- **`commands/tools.sh` is git-tracked but auto-generated**: never edit directly. Edit `src/commands/tools-template.ts`, run `pnpm generate:tools`, commit both. **CI does not verify sync** — stale `tools.sh` will ship silently if you forget `generate:tools`.
- **`docs/` is gitignored**: generated at build time by `pnpm fetch-docs` or during Docker build. Don't commit docs.
- **`tsconfig.json` excludes `tests/`**: vitest handles test TypeScript separately.
- **Normaliser pipeline is 3-pass** (see `UpdateDocSets.ts:360-396`): Pass 1 picks ONE format converter via `supportsFormat()` (MdxNormaliser or HtmlNormaliser). Pass 2 tries extension-based fallback if pass 1 missed. Pass 3 runs all cleanup normalisers (`supportsFormat()` returns false) — currently MarkdownCleaner then ContentSanitiser. Array order in `src/index.ts:20` determines priority. When adding a normaliser, `supportsFormat()` return value decides which pass it runs in.

## Architecture

- `src/index.ts` — fetch-docs entrypoint. Not the SSH server.
- `src/application/sources.ts` — canonical list of all doc sources. Two source types: `git` (sparse clone) and `http` (uses a discovery method — see "Adding a new doc source" below).
- `src/domain/` — value objects + port interfaces (`DocSource`, `DocIngestor`, `DocNormaliser`). Ports-and-adapters: implementations in `ingestors/` and `normaliser/`.
- `src/commands/tools-template.ts` — TypeScript source of truth for agent tools output. Generates `commands/tools.sh`.
- `commands/` — shell scripts for SSH built-in commands. Note: `src/commands/` (TypeScript, build-time) vs `commands/` (shell, runtime) are different dirs.
- `commands/lib/` — shared shell libraries: `colors.sh` (TTY detection), `log.sh` (JSONL audit logging), `cache.sh` (md5-keyed result caching in tmpfs).
- `commands/agents.sh` — dynamically generates agent instructions using live container data (source list, file counts). Supports formats: claude/cursor/gemini/skill/opencode.

## Docker / SSH runtime

- `entrypoint.sh` persists env to `/run/sshd/docs-ssh.env` because sshd drops container env. `log-cmd.sh` sources it back.
- `log-cmd.sh` is the `ForceCommand` — routes SSH sessions to interactive/builtin/exec handlers. Builtins are routed via `case` on first word of `SSH_ORIGINAL_COMMAND`.
- `build-index.sh` creates `/docs/_index.tsv` (path + title + summary per file) at image build time. This is what `docs_search` queries (~10-20MB vs ~300MB raw docs).
- Command caching: identical read/search commands return cached results from tmpfs. Docs are static per container lifetime.

## Adding a new SSH command

Add a `case` entry in `log-cmd.sh:44-58` and a script in `commands/`. Human-facing commands (like `help`) get `FORCE_COLOR=1`; machine-consumable commands (like `tools`) don't.

## Testing

- **Unit tests** (`tests/unit/`): mirror `src/` structure. No network or Docker needed.
- **E2E tests** (`tests/e2e/smoke.test.ts`): require Docker. 3-minute timeout. Build image with mock docs, start container, SSH against it.
- **Smoke tests** (`tests/smoke/smoke.test.ts`): require a live SSH server. Test all sources, index, API specs, builtins, security. Set `DOCS_SSH_HOST=docs.erfi.io` for production.
- **Benchmarks** (`tests/benchmark/`): token efficiency tests, require a live SSH server.
- Four vitest configs: `vitest.config.ts` (unit), `vitest.e2e.config.ts`, `vitest.smoke.config.ts`, `vitest.bench.config.ts`.

## Release / Deploy

- **CI** (every push/PR to main): lint → test:coverage.
- **Release** (push tag `v*`): fetch-docs → Docker build with `DOCS_PREBUILT=true` → push to `ghcr.io/erfianugrah/docs-ssh` → deploy to Composer (self-hosted Docker compose manager via API).
- **Daily cron** (02:00 UTC): same fetch+build+push, tags `latest` + date tag. Keeps docs fresh without code changes.
- **Version**: git tag is the single source of truth. `pnpm release:patch` bumps `package.json`, commits, tags, and pushes in one command. Landing page version injected from git tag at Docker build time; JS fallback fetches from GitHub tags API for self-hosted builds.

## Env vars

| Variable | Used by | Default |
|----------|---------|---------|
| `DOCS_OUT_DIR` | fetch-docs | `./docs` |
| `DOCS_WORK_DIR` | fetch-docs | `$TMPDIR/docs-ssh-work` |
| `DOCS_CONCURRENCY` | fetch-docs | `6` (parallel source fetches) |
| `DOCS_MAX_AGE` | fetch-docs | `86400` (seconds; 0 = always refresh) |
| `DOCS_SSH_HOST` | commands/*.sh | `localhost` |
| `DOCS_SSH_PORT` | commands/*.sh | `2222` |

## Adding a new doc source

Add a `new DocSource({...})` to `src/application/sources.ts`. Pick a discovery method that matches how the upstream provides docs. The ingestor and normaliser are selected automatically by type/format matching. Discovery methods: `tarball`, `llms-full`, `sitemap`, `sitemap-index`, `toc`, `llms-index`, `llms-txt`, `rss`, `openapi`, `none`.

## Modifying tools output

Edit `src/commands/tools-template.ts` (the TypeScript source of truth), then run `pnpm generate:tools` to regenerate `commands/tools.sh`. Commit both files. The unit test suite validates template exports but does not check `tools.sh` is in sync.

## Single source of truth

The SSH server is the canonical source for all agent configuration. The `agents` command dynamically generates instructions using live container data (source list, file counts).

```bash
ssh docs.erfi.io agents              # AGENTS.md (default, raw SSH patterns)
ssh docs.erfi.io agents opencode     # AGENTS.md for OpenCode (references custom docs_* tools)
ssh docs.erfi.io agents claude       # CLAUDE.md
ssh docs.erfi.io agents cursor       # .cursorrules
ssh docs.erfi.io agents gemini       # GEMINI.md
ssh docs.erfi.io agents skill        # SKILL.md with YAML frontmatter
ssh docs.erfi.io agents help         # show all formats
```

When updating server features, redeploy and re-pull configs. Output is dynamic — file counts, source lists, and tool references are always current.
