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
pnpm mcp:serve            # run the MCP-over-HTTP server locally (node+tsx; DOCS_ROOT=./docs, MCP_PORT=8081)
pnpm mcp:build            # compile the MCP server to a single Bun binary (dist/docs-mcp, musl)
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
- **Normaliser pipeline is 3-pass** (see `UpdateDocSets.ts:362-398`): Pass 1 picks ONE format converter via `supportsFormat()` (MdxNormaliser or HtmlNormaliser). Pass 2 tries extension-based fallback if pass 1 missed. Pass 3 runs all cleanup normalisers (`supportsFormat()` returns false) — currently MarkdownCleaner then ContentSanitiser. Array order in `src/index.ts:20` determines priority. When adding a normaliser, `supportsFormat()` return value decides which pass it runs in. A format converter may also return `null` to DROP the file from the doc set - `HtmlNormaliser` does this when Turndown output is both <1KB and <1% of a >1KB input (RSC/SPA app-shell pages, e.g. paginated listing pages): the page has no doc value, and keeping it as raw `.html` breaks the smoke-test invariant that markdown-capable sources contain only `.md` files. Dropped pages are logged per source during fetch.
- **Pass 1 is skipped when `DocFile.preNormalised` is true** (markdown content negotiation): when `HttpIngestor.fetchPage()` receives `Content-Type: text/markdown` from an upstream that honours `Accept: text/markdown, text/html;q=0.9` (acceptmarkdown.com spec / Cloudflare Markdown for Agents), it tags the DocFile so the format converter is bypassed — running Turndown on existing markdown corrupts it via escaping. Pass 3 cleanup still runs. Fallbacks: thin markdown body (<256B) → retry as HTML; 404/406 → retry forcing `Accept: text/html` (only one in-the-wild case: turborepo `/docs/openapi/*`).

- **Origin URLs (`[url]`, v0.28.0)**: every `DocFile` carries an optional `originUrl` captured at fetch time so agents can cite the public page, not just the corpus path. http sources: the fetched page URL (post-redirect); bulk discoveries (llms-full, tarball, texinfo, openapi) fall back to the source `url`; RFCs map to `https://www.rfc-editor.org/rfc/rfc<N>.html` (RsyncIngestor); statuspage incidents to `/incidents/<code>`. git sources: `repoBrowseUrl()` in `src/shared/origin-url.ts` (GitHub `blob/HEAD`, GitLab `-/blob/HEAD`, Codeberg/Gitea/Forgejo `src/branch/<checked-out branch>`, unknown host -> no URL) computed from the ORIGINAL repo path (before `.mdx`->`.md`/rootPath stripping), unless the `DocSource` sets `publicUrl(repoRelPath)` - currently only `erfi-technical-blog` (`lexicanumPublicUrl`, Starlight -> `https://erfi.dev/<slug>/`, in `src/application/public-urls.ts`). `erfi-personal-blog` stays on the GitHub blob fallback on purpose: its live URLs come from per-file `slug:` frontmatter, which a path-only mapper cannot reproduce. GitIngestor converter outputs (adoc, trash-guides, openapi-dir) have no origin (not 1:1 with repo files). **Persistence**: `UpdateDocSets` writes the per-source map into `<source>/.stamp.json` (`origins`), which only a real fetch rewrites, so cached runs keep it; `src/index.ts` then merges every stamp into root `docs/_origins.tsv` (`<source>/<relpath.md>\t<url>`, next to `_source_groups.json`; never inside `docs/<source>/`, which must stay markdown-only). **Tools**: `docs_read`/`docs_summary` (SSH templates + `src/mcp/docs-service.ts`) print `[url] <url>` under `[source]` when an entry exists (awk lookup prepended to the same command, split off by `splitOrigin()`); `docs_search` appends the URL as a 4th tab column via an awk join guarded by `[ -s /docs/_origins.tsv ]`. Missing file or entry = byte-identical output to pre-0.28. To add a site mapping for another git source, add a `publicUrl` function + unit test and verify two URLs return 200 live.
- **Clients outside this repo are forks, not generated**: the user's pi docs tools and the Claude Code MCP toolkit run `~/dotfiles/.pi/agent/extensions/lib/docs-core.ts` (shared by `docs.ts` and `.claude/mcp/toolkit.ts`), a hand-maintained port of the SSH templates. A tool-output change here (e.g. the v0.28.0 `[url]` header) does NOT reach them until docs-core.ts is ported too. The v0.28.0 `[url]` change was ported to docs-core.ts in dotfiles on 2026-09-30; keep the two in step by hand.

## MCP-over-HTTP server

A second transport (alongside SSH) so remote chat LLMs that can't SSH (Claude.ai custom connectors, ChatGPT connectors) can use the docs corpus. Streamable HTTP transport, MCP spec 2025-11-25. Additive - the SSH path is untouched.

- `src/mcp/docs-service.ts` - transport-agnostic core for the six ops (search/read/grep/find/summary/sources). Identical rg/bat/find/awk pipelines and output formatting to the SSH builtins (`src/commands/tools-pi-template.ts`), but with a configurable docs root and a local `node:child_process` runner instead of an SSH hop. Injectable `Runner` makes it unit-testable without real binaries.
- `src/mcp/server.ts` - stateless MCP server (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), six `registerTool` wrappers (Zod schemas), `enableDnsRebindingProtection` with Origin/Host allowlists from env. Also serves the static landing page from `MCP_STATIC_DIR` for non-`/mcp` GETs, so one listener carries both surfaces (avoids Fly's one-service-per-external-port limit). `buildServer(service?)` takes an optional DocsService for test injection.
- `src/mcp/main.ts` - `listen()` entrypoint, split out so tests import `server.ts` without binding a port.
- **Stateless on purpose**: all six ops are idempotent reads over a filesystem that's immutable per container lifetime, so no session store, horizontal-scalable, CDN-cacheable.
- **Bun-compiled**: `pnpm mcp:build` (and the Dockerfile `mcp-builder` stage, `oven/bun:1-alpine`) produce a single musl binary via `bun build --compile`. The Alpine runtime stage needs `libstdc++ libgcc` for it (already in the Dockerfile `apk add`). No Node/node_modules in the runtime stage.
- **Env**: `DOCS_ROOT` (/docs), `MCP_PORT` (8081 dev; entrypoint runs it on 8080), `MCP_HOST`, `MCP_STATIC_DIR`, `MCP_ALLOWED_HOSTS`, `MCP_ALLOWED_ORIGINS`, `VERSION` (serverInfo.version). Endpoints: `POST /mcp`, `GET /healthz`, `GET /*` -> static.
- Tests: `tests/unit/mcp/` - mock-runner command construction + safePath jail, in-memory-transport MCP wiring, real-binary integration (skips when `rg` absent).

## Architecture

- `src/index.ts` - fetch-docs entrypoint. Not the SSH server.
- `src/application/sources.ts` — canonical list of all doc sources. Two source types: `git` (sparse clone) and `http` (uses a discovery method — see "Adding a new doc source" below).
- `src/domain/` — value objects + port interfaces (`DocSource`, `DocIngestor`, `DocNormaliser`). Ports-and-adapters: implementations in `ingestors/` and `normaliser/`.
- `src/commands/tools-template.ts` — TypeScript source of truth for agent tools output. Generates `commands/tools.sh`.
- `src/shared/retry.ts` — `retryWithBackoff` + `backoffDelay` used by every network-dependent code path (HTTP fetches in `HttpIngestor`, HEAD freshness checks in `UpdateDocSets`, git clone/pull/ls-remote in `GitIngestor`). Jittered exponential backoff; `shouldRetry` predicate lets callers short-circuit on non-retryable errors.
- `commands/` — shell scripts for SSH built-in commands. Note: `src/commands/` (TypeScript, build-time) vs `commands/` (shell, runtime) are different dirs.
- `commands/lib/` — shared shell libraries: `colors.sh` (TTY detection), `log.sh` (JSONL audit logging), `cache.sh` (md5-keyed result caching in tmpfs).
- `commands/agents.sh` — dynamically generates agent instructions using live container data (source list, file counts). Supports formats: claude/cursor/gemini/skill/opencode.

## Docker / SSH runtime

- Two-stage `Dockerfile`: Node fetcher stage + Alpine runtime. `DOCS_PREBUILT=true` build arg skips the fetch by copying pre-fetched `docs/` from the build context — what `pnpm docker:build` and CI release use.
- **SSH host keys are ephemeral**: `entrypoint.sh` generates them into the `/run/sshd` tmpfs on every container start, so every deploy changes the host key and a strict `ssh docs.erfi.io` fails with "host key has changed". The generated tools and dotfiles docs-core.ts connect with `StrictHostKeyChecking=no` for this reason. To re-pin interactively, verify out of band first: `ssh servarr 'docker exec docs-ssh ssh-keygen -lf /run/sshd/ssh_host_ed25519_key.pub'` must match the fingerprint offered, then `ssh-keygen -R '[docs.erfi.io]:2222'` and reconnect.
- `entrypoint.sh` persists env to `/run/sshd/docs-ssh.env` because sshd drops container env. `log-cmd.sh` sources it back.
- `log-cmd.sh` is the `ForceCommand` — routes SSH sessions to interactive/builtin/exec handlers. Builtins are routed via `case` on first word of `SSH_ORIGINAL_COMMAND`.
- Three image-build-time scripts run in sequence: `build-index.sh` → `/docs/_index.tsv` (path + title + summary per file, what `docs_search` queries); `build-sources-json.sh` → `/docs/_sources.json` (powers landing page + banner); `build-health-check.sh` (warnings only, never fails the build).
- Command caching: identical read/search commands return cached results from tmpfs. Docs are static per container lifetime.
- **HTTP on 8080** (`entrypoint.sh`): the Bun-compiled `docs-mcp` binary serves BOTH the static landing page (`GET /`) and the MCP endpoint (`POST /mcp`) on 8080, falling back to busybox httpd (landing page only) if the binary is absent. Fly maps external 80/443 -> 8080; no separate MCP service/port. `GET /healthz` backs the Fly http_check.

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
- **Build** (`.forgejo/workflows/build.yml`, since 2026-09-30 - replaced `release.yml` + `update-docs.yml`): ONE workflow for tag `v*` releases, the 02:00 UTC daily refresh and manual runs, all in the `docker-push` concurrency group. A plan step (`src/ci/plan-cli.ts` -> `planBuild` in `src/ci/build-plan.ts`, unit-tested in `tests/unit/ci/`) reads `docs/_build.json` (`fetchedAt`, `commit`) from the persistent cache and decides: tag = always build, fetch only if docs are >= 20h old or fetcher code (`FETCHER_PATHS`: src/ingestors, src/normaliser, src/application, src/domain, src/shared, src/index.ts, package.json, pnpm-lock.yaml) changed since that commit; schedule = skip the whole run when docs are < 20h old and fetcher code is unchanged (a release fetched them), else fetch; dispatch = like tag, input `refresh: true` forces a full refetch. Fetcher-code change -> `DOCS_MAX_AGE=0` (regenerate every source with the new code); otherwise a warm fetch with `DOCS_MAX_AGE=129600` (36h per-source trust window, git clones kept in `work/`). `verify` (tools.sh sync, lint, unit, e2e) gates tags only; schedule/dispatch build `main`, which CI already gated. Then build with `DOCS_PREBUILT=true` -> push `latest` + date (+ semver on tags) to GHCR (`secrets.GHCR_TOKEN`) -> deploy through Composer (`COMPOSER_URL`/`COMPOSER_API_KEY`, async job poll) -> smoke against live. **Cache**: docker volume `docs-ssh-cache` on the router daemon (jobs drive the host daemon via the automounted socket), holding `docs/` and `work/`, moved with `docker cp` through a throwaway `alpine` container (no runner `valid_volumes` change needed). Saved right after a fetch, before the build, so a failed build/deploy never loses a fetch; swap is `*.new` then rename. Deleting the volume = next run is a cold fetch (~2h20m; the runner caps jobs at 3h). `docs/_build.json` also ships in the image (root `_*` files are excluded from source counts like `_origins.tsv`). `deploy/composer/` is HISTORY: the `docs-ssh-daily-update` Composer pipeline it describes was deleted 2026-08-31 (needed host-side builder setup); do not recreate it.
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
| `DOCS_CMD_TIMEOUT` | log-cmd.sh | `60` (seconds per SSH-executed command; timeout exits 124) |

## Adding a new doc source

Add a `new DocSource({...})` to `src/application/sources.ts`. Pick a discovery method that matches how the upstream provides docs. The ingestor and normaliser are selected automatically by type/format matching. Discovery methods: `none`, `tarball`, `texinfo`, `llms-full`, `llms-index`, `llms-txt`, `sitemap`, `sitemap-index`, `toc`, `rss`, `openapi`, `openapi-dir`, `mediawiki`, `dokuwiki`. Optional knobs: `tocDepth` (BFS depth for `toc` discovery; default 1 = single toc page; 2 = also crawl section index pages, e.g. openzfs-man), `pageConcurrency`, `deadlineMs`, `requestTimeoutMs`, `userAgent`, `skipMarkdownNegotiation`.

**Source-type preference order** (most → least reliable; pick the highest one the upstream actually offers):

1. **`type: "git"`** — clone+sparse-checkout the upstream's docs directory. Markdown direct from source. ~83 of 138 sources use this. Survives upstream HTML/JS/CSS rewrites; only breaks when the repo path changes.
2. **`type: "http"` + `discovery: "tarball"`** — single bulk archive (e.g. Supabase's `docs.tar.gz`). One fetch, no rendering, durable.
3. **`type: "http"` + `discovery: "llms-full"`** — single AI-targeted text dump from the upstream. Lighter than tarball, common pattern (Vercel, Cloudflare, Next.js, Bitwarden).
4. **`type: "http"` + `discovery: "openapi"` / `"openapi-dir"`** — for API specs. Converted to per-tag markdown by `openapi-converter.ts`.
5. **Other discovery methods** (`sitemap`, `toc`, `llms-txt`, `llms-index`, `rss`, `mediawiki`) — last resort. These all run page-by-page HTML scraping; brittle to upstream JS-rendering, format changes, missing pages. **HttpIngestor opportunistically sends `Accept: text/markdown, text/html;q=0.9` per the acceptmarkdown.com spec**; upstreams running Cloudflare's "Markdown for Agents" or supporting RFC 7763 content negotiation return clean markdown directly (verified live: cloudflare/cloudflare-blog/cloudflare-changelog/turborepo/prisma/resend/vercel-blog/ansible/patroni), bypassing Turndown via `DocFile.preNormalised`. Origins that don't support it return HTML normally - no behaviour change. Exception: origins whose WAF hard-rejects the markdown Accept header (verified: openvpn.net 503s every page carrying it, 200s without) need `skipMarkdownNegotiation: true` on the `DocSource` to force plain `Accept: text/html`.

**Throttling a large rate-limit-prone scrape** — set `pageConcurrency` (per-page parallelism, default global `CONCURRENCY=15`) and `deadlineMs` (per-source hard deadline, default 10 min) on the `DocSource`. `cloudflare-blog` is the canonical case: blog.cloudflare.com sits behind Cloudflare's own bot/rate management, so the 15-wide default burst trips throttling and collapses the source to **zero files** (which then blows the 10-min deadline and silently lands an empty source in the image, since a fresh CI fetch has no prior baseline for the regression-threshold check to catch). Throttling to `pageConcurrency: 4` + `deadlineMs: 2_400_000` (40 min) fetches all ~3500 posts with zero retries/429s in ~25 min. Verify a single source without a full ~30-min build via `DOCS_ONLY=cloudflare-blog DOCS_OUT_DIR=/tmp/x DOCS_MAX_AGE=0 pnpm fetch-docs`.

**Origins that block the bot User-Agent** - set `userAgent` on the `DocSource` to override the UA for that source's page fetches (a shared `BROWSER_UA` const lives at the top of `sources.ts`). Verified cases: planalto.gov.br ECONNRESETs the docs-ssh UA, legisquebec.gouv.qc.ca and sso.agc.gov.sg 403 it; all 200 with a browser UA. Diagnose by replaying the failing URL with `node -e fetch(...)` once with the docs-ssh UA and once with a browser UA - an HTTP status change (or ECONNRESET -> 200) means UA filtering; a timeout in both (e.g. riksdagen.se's broken IPv6 route, which hangs undici but not curl -4) means find an alternate official host instead. For origins behind an AWS WAF JS challenge (eur-lex.europa.eu, legislation.gov.uk) or hard bot-blocking (legifrance.gouv.fr), no UA helps - use a Wayback Machine raw capture (`https://web.archive.org/web/<ts>id_/<url>` serves the original bytes; statutes change slowly so a pinned capture is fine, and the `privacy-laws-*` sources use this pattern).

**rsync-only bulk mirrors (IETF RFCs)** - use `type: "rsync"` + `format: "txt"` with `url` set to the module spec (e.g. `rsync.rfc-editor.org::rfcs-text-only`). The RFC Editor retired its RFC-all tarball; rsync is the only sanctioned bulk channel and is incremental, so daily refresh transfers only new/changed files against the work-dir cache. `RsyncIngestor` syncs the module (with `-L` to materialise the module's symlinks); `TxtNormaliser` converts each `.txt` to fenced `.md` with an H1 parsed from the RFC header block (so build-index gets real title rows) plus the Abstract first paragraph as unfenced prose (feeds the search summary). Requires `rsync` in the Dockerfile fetcher stage. Limitation: ~1% of pre-1990 RFCs have freeform headers that defeat title extraction - they get a bare `# RFC <N>` heading and stay searchable by number.

**DokuWiki wikis (OpenWrt, FreshTomato)** - use `type: "http"` + `discovery: "dokuwiki"`. DokuWiki has no API and usually no sitemap, but its `?do=index` page renders the full namespace tree server-side: namespace links carry `?idx=<ns>` (colon-form, URL-encoded when nested), page links are ordinary content URLs, so `dokuwiki.ts` BFS-walks the idx pages to enumerate the wiki. The source's `urlExclude` regex doubles as a crawl-time namespace prune (an `idx=X` value is tested as the synthetic page path `<url><X-with-slashes>/`), which is how openwrt drops its ~20 translation namespaces and the 27.5k auto-generated `/packages/` stubs before a single fetch. Page URL shape differs per wiki template: openwrt uses clean root URLs (`/docs/guide`), freshtomato uses PATH_INFO (`/doku.php/page`) - set `url` accordingly, since it's the page-link prefix the crawl accepts. Caps: 2000 idx pages / 20k page URLs.

**MySQL-style manuals published only as GNU info** — use `type: "http"` + `discovery: "texinfo"`. The MySQL Reference Manual isn't markdown or in any git repo, and dev.mysql.com is HTML-only with no sitemap/llms.txt and no content negotiation. The one mirror-able form is the texinfo build shipped as `mysql-X.info.zip`: a single ~4MB archive unpacking to the whole manual (~2,400 nodes). `HttpIngestor.ingestFromTexinfo` downloads + unzips it (via `fflate`, so no system `unzip` dep) and `info-splitter.ts` splits the `0x1f`-delimited nodes into per-node markdown, converting `* Menu:` blocks to bullet-link lists, setext underlines to ATX headings (min-level normalised so the node title is H1), and inline `*note` cross-references to links. Limitation: a handful of labels containing a literal `*` (e.g. `'SELECT *'`) leak the raw `*note` token — ~0.02 per page, cosmetic.

**AsciiDoc / Antora docs (Debezium)** — use `type: "git"` + `format: "adoc"`. The GitIngestor routes the checkout through `asciidoc-converter.ts`, which renders each `modules/ROOT/pages/**/*.adoc` with Asciidoctor.js (pure JS, no Ruby), resolving `include::`/`ifdef::community,product[]`/`xref:`/attributes against the on-disk partials using the `antora.yml` attribute set plus per-page header attributes (so `{connector-name}` resolves inside shared partials), then Turndown → markdown. Cleanup strips Asciidoctor's visible "Unresolved directive" placeholders, rewrites `xref` `.html` targets to `.md`, and drops empty section-anchor links. Conversion lives in the ingestor (not a `DocNormaliser`) because `include::` needs the whole checkout on disk — same rationale as `openapi-converter.ts`. Limitation: Debezium's connector config-property tables are generated from Java at build time and absent from git, so those few fragments don't appear in the mirror.

**Go libraries without markdown docs** — use `type: "git"` + `format: "godoc"`. The GitIngestor walks `.go` files (skipping `_test.go`, `z*.go`, `*.pb.go`, `*_string.go`, `*_generate.go`) and `GoNormaliser` extracts the package decl, package-level doc, and exported declarations (func/method/type/const/var) with their doc comments into one markdown file per source `.go` file. Methods are grouped under `## Methods on T` per receiver. Used by `miekg-dns` (v1, GitHub) and `miekg-dns-v2` (v2, Codeberg). Limitation: the extractor is a line-based state machine, not a Go AST parser; inline `struct{...}` return types in function signatures are a known edge case that may truncate a signature mid-type. Acceptable trade-off for avoiding a Go toolchain dep in the fetcher stage.

**MkDocs with jinja/macro/snippet directives (TRaSH-Guides)** - use `type: "git"` + `format: "markdown"` + `resolveTrashGuides: true`, with `paths: ["docs", "includes"]` (the `includes/` tree lives at repo root and is referenced by the directives, so it must be sparse-checked out). `trash-guides-converter.ts` (invoked from GitIngestor) resolves the four MkDocs preprocessing layers the upstream commits raw: `--8<-- "..."` snippets (pymdownx.snippets, base repo root), `{! include-markdown "..." !}` (base: including file's dir), `[[% include 'json/...' %]]` / `[[% filter indent(width=N) %]]` (mkdocs-macros), and `{{ sonarr['...']['...'] }}` lookups (markdownextradata, against `docs/json/**`). Resolution semantics were verified against each plugin's source. The two `Guide-Sync/*-cf-groups.md` pages are full Jinja control-flow templates (`{% for %}`, macros) with Python object semantics (`.split()`, `.get()`, `namespace()`, string `in`) that no JS template engine supports, so they are batch-rendered through a bundled Python + Jinja2 helper (`src/ingestors/jinja-render.py`, invoked via `node:child_process`). Jinja2 must be present wherever fetch-docs runs: `python3 py3-jinja2` in the Dockerfile fetcher stage, `pip install jinja2` in the release workflow's fetch step, and the local dev box. A missing python3/jinja2 degrades gracefully (the templates stay raw) rather than failing the source.

**AWS is the last entry in the SOURCES array on purpose** — it discovers ~14k page URLs across ~80 services and is by far the slowest source. Placing it last means earlier batches don't wait behind it.

**Two helper scripts in `scripts/` for evaluating new sources** (devDeps: playwright, @mozilla/readability, jsdom):
- `pnpm tsx scripts/probe-sources.ts > /tmp/probe.tsv` — checks every existing source for archive / llms-full / llms.txt / known-git availability. Used to drive the v0.14.0 mass migration.
- `pnpm tsx scripts/audit-sources.ts > /tmp/audit.tsv` — fetches each `format: "html"` source's sample page two ways (plain `fetch` + Turndown, then headless Chromium + Mozilla Readability) and classifies KEEP / JS / DROP. Useful when adding a JS-heavy source to confirm a sitemap-based ingestion will yield usable markdown before committing to it.

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
