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

CI runs two parallel jobs on every push/PR: `test` (verify tools.sh sync → lint → test:coverage) and `e2e` (Docker-based E2E). Match locally when debugging CI failures. `release.yml` re-runs the full verification (tools sync + lint + unit + E2E) before building+pushing on tag pushes.

## Gotchas

- **ESM-only**: `"type": "module"` in package.json. All imports must use `.js` extensions (e.g. `import { Foo } from "./foo.js"`), even though source files are `.ts`.
- **tsx runtime**: scripts use `node --import tsx/esm`, not `ts-node` or compiled JS. No build step needed for dev.
- **`commands/tools.sh` is git-tracked but auto-generated**: never edit directly. Edit `src/commands/tools-template.ts`, run `pnpm generate:tools`, commit both. **CI verifies sync** via `git diff --exit-code` — a stale `tools.sh` fails CI.
- **Adding a doc source requires tagging it**: add to `src/application/sources.ts` AND to `SOURCE_TAGS` in `src/application/source-tags.ts`. `tests/unit/application/source-tags.test.ts` enforces a bijection — unit tests fail for untagged sources AND for tag entries referencing removed sources. Untagged sources are also excluded from `_source_groups.json` (which `agents.sh` uses to generate the "Related source groups" section).
- **`src/index.ts` writes `docs/_source_groups.json`** as a side effect of every fetch (see `src/index.ts:51-65`). Also regeneratable standalone via `src/commands/generate-source-groups.ts`.
- **`docs/` is gitignored**: generated at build time by `pnpm fetch-docs` or during Docker build. Don't commit docs.
- **`tsconfig.json` excludes `tests/`**: vitest handles test TypeScript separately.
- **Normaliser pipeline is 3-pass** (see `UpdateDocSets.ts:362-398`): Pass 1 picks ONE format converter via `supportsFormat()` (MdxNormaliser or HtmlNormaliser). Pass 2 tries extension-based fallback if pass 1 missed. Pass 3 runs all cleanup normalisers (`supportsFormat()` returns false) — currently MarkdownCleaner then ContentSanitiser. Array order in `src/index.ts:20` determines priority. When adding a normaliser, `supportsFormat()` return value decides which pass it runs in.

## Architecture

- `src/index.ts` — fetch-docs entrypoint. Not the SSH server.
- `src/application/sources.ts` — canonical list of all doc sources. Two source types: `git` (sparse clone) and `http` (uses a discovery method — see "Adding a new doc source" below).
- `src/domain/` — value objects + port interfaces (`DocSource`, `DocIngestor`, `DocNormaliser`). Ports-and-adapters: implementations in `ingestors/` and `normaliser/`.
- `src/commands/tools-template.ts` — TypeScript source of truth for agent tools output. Generates `commands/tools.sh`.
- `commands/` — shell scripts for SSH built-in commands. Note: `src/commands/` (TypeScript, build-time) vs `commands/` (shell, runtime) are different dirs.
- `commands/lib/` — shared shell libraries: `colors.sh` (TTY detection), `log.sh` (JSONL audit logging), `cache.sh` (md5-keyed result caching in tmpfs).
- `commands/agents.sh` — dynamically generates agent instructions using live container data (source list, file counts). Supports formats: claude/cursor/gemini/skill/opencode.

## Docker / SSH runtime

- Two-stage `Dockerfile`: Node fetcher stage + Alpine runtime. `DOCS_PREBUILT=true` build arg skips the fetch by copying pre-fetched `docs/` from the build context — what `pnpm docker:build` and CI release use.
- `entrypoint.sh` persists env to `/run/sshd/docs-ssh.env` because sshd drops container env. `log-cmd.sh` sources it back.
- `log-cmd.sh` is the `ForceCommand` — routes SSH sessions to interactive/builtin/exec handlers. Builtins are routed via `case` on first word of `SSH_ORIGINAL_COMMAND`.
- Three image-build-time scripts run in sequence: `build-index.sh` → `/docs/_index.tsv` (path + title + summary per file, what `docs_search` queries); `build-sources-json.sh` → `/docs/_sources.json` (powers landing page + banner); `build-health-check.sh` (warnings only, never fails the build).
- Command caching: identical read/search commands return cached results from tmpfs. Docs are static per container lifetime.

## Adding a new SSH command

Add a `case` entry in `log-cmd.sh:44-59` and a script in `commands/`. Human-facing commands (like `help`) get `FORCE_COLOR=1`; machine-consumable commands (like `tools`) don't.

## Testing

- **Unit tests** (`tests/unit/`): mirror `src/` structure. No network or Docker needed.
- **E2E tests** (`tests/e2e/smoke.test.ts`): require Docker. 3-minute timeout. **Wipes `./docs/` at setup AND teardown** to build with mock fixtures — running this after `pnpm fetch-docs` or `docker:build:cached` will delete cached docs, forcing a re-fetch next time.
- **Smoke tests** (`tests/smoke/smoke.test.ts`): require a live SSH server. Test all sources, index, API specs, builtins, security. Default host is `localhost`; set `DOCS_SSH_HOST=docs.erfi.io` to test production.
- **Benchmarks** (`tests/benchmark/`): token efficiency tests, require a live SSH server.
- Four vitest configs: `vitest.config.ts` (unit), `vitest.e2e.config.ts`, `vitest.smoke.config.ts`, `vitest.bench.config.ts`.

## Release / Deploy

- **CI** (every push/PR to main): verify `tools.sh` in sync → lint → test:coverage. `test` and `e2e` jobs run in parallel.
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

Add a `new DocSource({...})` to `src/application/sources.ts`. Pick a discovery method that matches how the upstream provides docs. The ingestor and normaliser are selected automatically by type/format matching. Discovery methods: `none`, `tarball`, `llms-full`, `llms-index`, `llms-txt`, `sitemap`, `sitemap-index`, `toc`, `rss`, `openapi`, `openapi-dir`, `mediawiki`.

## Modifying tools output

Edit `src/commands/tools-template.ts` (the TypeScript source of truth), then run `pnpm generate:tools` to regenerate `commands/tools.sh`. Commit both files. Unit tests validate template exports; sync between template and generated shell is enforced by the CI "Verify tools.sh is in sync" step (see `Commands` section above).

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
