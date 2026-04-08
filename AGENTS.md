# AGENTS.md

## What this is

SSH docs server that serves 18 documentation sources as a searchable markdown filesystem over SSH. The Node.js codebase fetches, normalises, and writes docs; a Docker image serves them via OpenSSH with `ForceCommand` routing.

## Commands

```bash
pnpm install              # Node 22+, pnpm 10
pnpm lint                 # typecheck only (tsc --noEmit)
pnpm test                 # 171 unit tests (vitest, tests/unit/)
pnpm test:e2e             # 52 Docker-based E2E tests (builds image, starts container, SSH tests)
pnpm test:coverage        # unit tests with v8 coverage
pnpm generate:tools       # regenerate commands/tools.sh from TypeScript template
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
  commands/
    tools-template.ts   — canonical TypeScript source for the tools output (source of truth)
    generate-tools-sh.ts — renders template into commands/tools.sh at build time
commands/               — shell scripts for SSH built-in commands (help, sources, agents, tools, setup)
  lib/
    colors.sh           — TTY detection + brand color variables
    log.sh              — JSONL audit logging
    cache.sh            — command result caching (md5-keyed stdout/stderr/rc in tmpfs)
  banner.sh             — colored interactive banner (ASCII art + syntax-highlighted examples)
  help.sh               — colorized help (TTY-aware, plain text for agents)
  sources.sh            — colorized source listing (TTY-aware)
  agents.sh             — AGENTS.md snippet with workflow guide + tool reference (supports: claude/cursor/gemini/skill)
  tools.sh              — AUTO-GENERATED from src/commands/tools-template.ts (do not edit directly)
  setup.sh              — interactive setup guide
```

- `src/application/sources.ts` is the canonical list of all doc sources. Each uses a discovery method (tarball, llms-full, sitemap, toc, llms-index, llms-txt, git sparse).
- Domain layer uses ports-and-adapters: `DocIngestor` and `DocNormaliser` are interfaces; implementations are in `ingestors/` and `normaliser/`.
- `docs/` is gitignored — generated at build time by `pnpm fetch-docs` or during Docker build.
- `commands/tools.sh` is auto-generated. Edit `src/commands/tools-template.ts` and run `pnpm generate:tools`.

## Docker / SSH runtime

- The Docker image has two stages: fetcher (Node, fetches docs) and runtime (Alpine + OpenSSH + ripgrep + bat + jq + tree + less).
- `entrypoint.sh` generates host keys at startup, creates cache dir, starts busybox httpd on 8080, runs sshd on 2222.
- `log-cmd.sh` is the `ForceCommand` — thin router that sources `lib/colors.sh`, `lib/log.sh`, `lib/cache.sh` and routes to interactive/builtin/exec handlers.
- `sshd_config`: post-quantum KEX (sntrup761), chacha20/AES-GCM ciphers, ETM-only MACs, passwordless access, `AllowUsers docs`, read-only filesystem, `ForceCommand /usr/local/bin/log-cmd`.
- `build-index.sh` creates `/docs/_index.tsv` (path + title + summary per file) at image build time.
- Command caching: identical read/search commands return cached results from tmpfs (docs are static per container lifetime).

## Testing

- **Unit tests** (`tests/unit/`): mirror `src/` structure including `commands/tools-template.test.ts`. No network or Docker needed.
- **E2E tests** (`tests/e2e/smoke.test.ts`): 52 tests covering all built-in commands, agents subcommands (claude/cursor/gemini/skill/opencode), new tools (bat, tree, rg --json), caching, logging, SSH security, and ANSI-free exec mode. Build a Docker image with mock docs, start a container, run SSH commands against it. Require Docker. 3-minute timeout.
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

## Modifying tools output

Edit `src/commands/tools-template.ts` (the TypeScript source of truth), then run `pnpm generate:tools` to regenerate `commands/tools.sh`. The unit test suite validates all expected exports, helpers, rg --json parser, bat integration, and fallbacks.

## Single source of truth

The SSH server is the canonical source for all agent configuration. Never hand-edit client-side configs — always pull from the server:

```bash
# OpenCode tools + global AGENTS.md
ssh docs.erfi.io tools > ~/.config/opencode/tools/docs.ts
ssh docs.erfi.io agents opencode > ~/.config/opencode/AGENTS.md

# Per-project AGENTS.md (append)
ssh docs.erfi.io agents >> AGENTS.md

# Claude Code
ssh docs.erfi.io agents claude >> CLAUDE.md

# Cursor
ssh docs.erfi.io agents cursor >> .cursorrules

# Gemini CLI
ssh docs.erfi.io agents gemini >> GEMINI.md

# On-demand skill (any tool — OpenCode, Claude Code, Cursor, etc.)
mkdir -p .opencode/skills/docs-ssh   # or .claude/skills/docs-ssh
ssh docs.erfi.io agents skill > .opencode/skills/docs-ssh/SKILL.md
```

The `agents` command accepts a format argument:
- `agents` — AGENTS.md (default, raw SSH patterns for any agent)
- `agents opencode` — AGENTS.md for OpenCode (references custom docs_* tools, tells agent to never use raw SSH)
- `agents claude` — CLAUDE.md with header
- `agents cursor` — .cursorrules format
- `agents gemini` — GEMINI.md with header
- `agents skill` — SKILL.md with YAML frontmatter
- `agents help` — show all formats

When updating the server (new tools, sources, features), redeploy and re-pull configs. The server output is dynamic — file counts, source lists, and tool references are always current.
