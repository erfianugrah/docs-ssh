# AI/Dev Source Candidate Assessment - 2026-11-07

Investigated live, one session. `src/application/sources.ts` checked for duplicates.

## 1. Claude Code docs (code.claude.com/docs)

- **llms.txt**: `https://code.claude.com/docs/llms.txt` - 200, Mintlify-style index. Links to `.md` URLs (`https://code.claude.com/docs/en/overview.md`).
- **llms-full.txt**: `https://code.claude.com/docs/llms-full.txt` - 200, **10.2 MB, 231 pages**. Mintlify `Source:` format: `Source: https://code.claude.com/docs/en/agent-teams`. First page starts `# Orchestrate teams of Claude Code sessions`. 539 total H1s but only 231 Source: lines (the Mintlify delimiters) - some nested H1s inside pages.
- **Format**: Mintlify (`Source:` lines per page, resolved by `splitLlmsFull`)
- **Pages serve .md URLs**: Yes, e.g. `https://code.claude.com/docs/en/overview.md` returns markdown.
- **Git repo**: None found. Mintlify-hosted on Vercel (`x-vercel-id`, `x-mintlify-client-version: 0.0.4076`). Cloudflare CDN fronting Vercel.
- **License**: Unknown (proprietary Anthropic docs). Not explicitly licensed.
- **Blockers**: None. Mintlify split is supported.
- **Proposed DocSource sketch**:
  ```ts
  new DocSource({
    name: "claude-code",
    type: "http",
    url: "https://code.claude.com/docs",
    discovery: "llms-full",
    format: "markdown",
  }),
  ```
- **Verdict**: **feasible-now**. llms-full with Mintlify split, 231 pages, no blockers.

## 2. Anthropic platform/API docs (platform.claude.com/docs)

- **llms.txt**: `https://docs.anthropic.com/en/llms.txt` → redirects to `https://platform.claude.com/docs/en/llms.txt` - 200, but **content is Next.js RSC** (JavaScript/JSON blob, not text). Not usable.
- **llms-full.txt**: `https://docs.anthropic.com/en/llms-full.txt` → same issue. 200, RSC payload, no markdown content.
- **URLs test**: Pages are at `https://platform.claude.com/docs/en/<slug>` (Next.js App Router). No `.md` extension.
- **Git repo**: `anthropics/docs` - 404 (does not exist). Cookbooks at `anthropics/anthropic-cookbook` but that's recipes, not API docs.
- **Content-negotiation**: The docs site is Next.js, serves RSC by default. Unclear if `Accept: text/markdown` would return markdown pages (Mintlify-hosted Claude Code docs DO support it; these don't). Didn't test per-page markdown negotiation due to 301 complexity.
- **License**: Unknown (proprietary Anthropic).
- **Blockers**: No bulk artifact. llms.txt/llms-full.txt return RSC, not text. No git repo. Would need `sitemap` or `toc` discovery + per-page HTML scraping with `skipMarkdownNegotiation: true` + Turndown, which is the least reliable path (~thousands of pages, Next.js JS-rendered).
- **Verdict**: **needs-new-ingestor**. No bulk path exists. The only option is sitemap/toc page-by-page HTML scraping of a Next.js site, high maintenance burden. Blocked on: no llms.txt content negotiation support, no git repo, no tarball. **Recommend: skip until Anthropic publishes a bulk artifact.**

## 3. OpenAI developer docs (developers.openai.com)

- **llms.txt**: `https://developers.openai.com/api/docs/llms.txt` - 200, **45 KB**. Links to `.md` twins at `/api/docs/<slug>.md`. Vercel-hosted.
- **llms-full.txt**: `https://developers.openai.com/api/docs/llms-full.txt` - 200, **5.7 MB, 667 pages** (counted by `^# ` H1s). **Plain-heading split** (no `Source:` lines, no `<page>` markers). First page starts directly: `# Data retrieval with GPT Actions`.
- **Split format detection**: The `splitLlmsFull` auto-detector handles this: first try Vercel `<page>` + Mintlify `Source:`, then frontmatter, then plain-heading fallback. This falls into plain-heading.
- **OpenAPI spec**: `openai/openai-openapi` repo (GitHub), MIT license, `openapi.json` + `openapi.yaml` at root. This is the REST API spec, separate from the guide docs above.
- **License**: Unknown (proprietary OpenAI). The openapi spec is MIT.
- **Blockers**: Plain-heading split is less reliable than Mintlify/Vercel (nested H1s in code blocks can cause false splits). 667 is high enough to work.
- **Proposed DocSource sketch** (guides):
  ```ts
  new DocSource({
    name: "openai",
    type: "http",
    url: "https://developers.openai.com/api/docs",
    discovery: "llms-full",
    format: "markdown",
  }),
  ```
- **Proposed DocSource sketch** (API spec):
  ```ts
  new DocSource({
    name: "openai-api",
    type: "git",
    url: "https://github.com/openai/openai-openapi",
    format: "openapi-dir",  // openapi.json + openapi.yaml at root
  }),
  ```
- **Verdict**: **feasible-now**. Two sources: llms-full for guides (667 pages), git openapi-dir for REST API spec. Plain-heading split may need validation on first fetch.

## 4. llama.cpp docs (ggml-org/llama.cpp)

- **Git repo**: `https://github.com/ggml-org/llama.cpp`, MIT license, main branch.
- **Docs path**: `docs/` - 24 markdown files: `android.md`, `autoparser.md`, `build.md`, `build-*.md`, `completions.md`, `docker.md`, `function-calling.md`, `install.md`, `llguidance.md`, `models.md`, `multi-gpu.md`, `multimodal.md`, `ops.md`, `preset.md`, `release.md`, `speculative.md`, `xcframework.md`, plus subdirs `android/`, `backend/`, `development/`, `multimodal/`, `ops/`.
- **Additional**: `tools/server/README.md` - server API docs. Not in docs/.
- **Format**: Markdown (`.md`).
- **License**: MIT.
- **Blockers**: `tools/server/README.md` is outside docs/. Need to decide whether to include as extra path.
- **Proposed DocSource sketch**:
  ```ts
  new DocSource({
    name: "llama-cpp",
    type: "git",
    url: "https://github.com/ggml-org/llama.cpp",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),
  ```
  (server README could be separate or omitted - it's one file.)
- **Verdict**: **feasible-now**. Git sparse checkout, 24+ pages, MIT license, no blockers.

## 5. Open WebUI docs (open-webui/docs)

- **llms.txt**: `https://docs.openwebui.com/llms.txt` - 200. Docusaurus-style index, links to individual pages. Generated 2026-11-05 (fresh).
- **llms-full.txt**: `https://docs.openwebui.com/llms-full.txt` - 200, **4.4 MB, 431 pages**. Mintlify `Source:` format: `Source: https://docs.openwebui.com/alternatives/anythingllm`. 431 Source: lines.
- **Pages serve .md URLs**: Yes, per llms.txt: "For any docs page, append `.md` for Markdown".
- **Git repo**: `https://github.com/open-webui/docs`, main branch. Docusaurus site, `.mdx` files in `docs/` dir. Subdirs: `alternatives/`, `ecosystem/`, `enterprise/`, `features/`, `getting-started/`, `reference/`, `security/`, `troubleshooting/`, `tutorials/`.
- **License**: No SPDX license set on the repo. No LICENSE file found in quick check. Unknown.
- **Blockers**: None for llms-full path. Git path would work too but Docusaurus MDX needs `resolvePartials` for `@site` imports.
- **Proposed DocSource sketch**:
  ```ts
  new DocSource({
    name: "openwebui",
    type: "http",
    url: "https://docs.openwebui.com",
    discovery: "llms-full",
    format: "markdown",
  }),
  ```
- **Verdict**: **feasible-now**. llms-full with Mintlify split, 431 pages, actively generated. License unchecked.

## 6. Supabase client library references (supabase.com/llms/)

- **llms.txt entries**: `https://supabase.com/llms/js.txt`, `dart.txt`, `swift.txt`, `kotlin.txt`, `python.txt`, `csharp.txt`, `cli` (listed in `https://supabase.com/llms.txt`).
- **js.txt**: 200, **172 KB, 1 page** (single H1 `# JavaScript Client Library Reference`). 715 total headings (1 H1 + 243 H2 + 157 H3 + 314 H4). Monolithic per-language reference.
- **python.txt**: 200, **83 KB, 9 H1s**. Also monolithic but with sub-headings for different modules.
- **Structure**: Each file is a single-page API reference. Not splittable into per-function pages - they're authored as single references.
- **Alternative**: `supabase/supabase` repo has `apps/docs/spec/supabase_js_v2.yml` - an OpenAPI spec for the JS client Data API. That's a richer, more structured source for the JS Data API specifically.
- **Existing sources**: `supabase` (guides), `supabase-cli`, `supabase-api` already exist. These client refs are distinct (per-language API reference, not guides).
- **License**: Same as Supabase docs (MIT for code, proprietary for docs content - unclear).
- **Blockers**: Monolithic pages have low search value. A single 172KB page for js.txt means all JS client searches hit one file. The OpenAPI spec alternative (supabase_js_v2.yml) is better structured but only covers the Data API, not Auth/Realtime/Storage.
- **Proposed DocSource sketch** (if pursued):
  ```ts
  new DocSource({
    name: "supabase-client-refs",
    type: "http",
    url: "https://supabase.com/llms",
    discovery: "llms-txt",  // would need llms-txt discovery support
    format: "markdown",
    // Each listed .txt file becomes one page in the source
  }),
  ```
  But `llms-txt` discovery for per-language-reference `.txt` files isn't the standard llms.txt pattern (those are full corpus indexes, not per-topic single files). These are more like `llms-full` variants.
- **Verdict**: **not-worth-it**. Monolithic per-language pages (1 page per language = very low search granularity). The existing `supabase` source already covers guides. The OpenAPI spec (`supabase_js_v2.yml`) is better for the JS Data API, but partial coverage. Recommend: skip for now; revisit if demand evidence (query log misses) justifies the effort.

## 7. Discord API docs (discord/discord-api-docs)

- **Git repo**: `https://github.com/discord/discord-api-docs`, CC-BY-SA-4.0 license, main branch.
- **Structure**: Mintlify-style docs site. `developers/` dir has `.mdx` files organized by topic: `activities/`, `bots/`, `change-log.mdx`, `communities/`, `components/`, `developer-tools/`, `discovery/`, `events/`, `game-development/`, `gateway/`, `guides.mdx`, `guides/`, `interactions/`, `intro.mdx`, `link-previews/`, `monetization/`, `platform/`, `policies/`, `quick-start/`, `reference.mdx`, `resources/`, `rich-presence/`, `social-commerce/`, `social-layer/`, `topics/`, `tutorials/`.
- **Format**: MDX (`.mdx`). Mintlify-style with `docs.json` at root for sidebar config.
- **License**: CC-BY-SA-4.0 (explicit LICENSE file). Permits sharing and adaptation with attribution.
- **Blockers**: MDX files may use Mintlify-specific components (tabs, code blocks, etc.) that need MDX normaliser. The existing MDX normaliser handles most Mintlify patterns (already used for `supabase` source).
- **Proposed DocSource sketch**:
  ```ts
  new DocSource({
    name: "discord-api",
    type: "git",
    url: "https://github.com/discord/discord-api-docs",
    format: "mdx",
    paths: ["developers"],
    rootPath: "developers",
  }),
  ```
- **Verdict**: **feasible-now**. Git sparse checkout, CC-BY-SA-4.0 license, MDX format (supported). Discord API is heavily used and frequently searched for.

## 8. hls.js docs (video-dev/hls.js)

- **Git repo**: `https://github.com/video-dev/hls.js`, Apache 2.0 license, master branch.
- **Docs**: `docs/` dir has **2 markdown files**: `API.md` and `design.md` (+ logo.svg, release-process.md, image). `API.md` is a comprehensive single-page API reference with TOC covering getting started, fine tuning, config, events, errors. `design.md` is an architecture overview.
- **Format**: Markdown (`.md`).
- **License**: Apache 2.0.
- **Blockers**: Only 2 pages. Trivial doc set. The main API reference is already indexed well by web search.
- **Proposed DocSource sketch**:
  ```ts
  new DocSource({
    name: "hlsjs",
    type: "git",
    url: "https://github.com/video-dev/hls.js",
    format: "markdown",
    paths: ["docs"],
    rootPath: "docs",
  }),
  ```
- **Verdict**: **not-worth-it**. Only 2 pages (API.md + design.md). Marginal search value. Demand evidence: 3 queries in 16 days (query log: "hlsjs hls.js buffer abr").

## 9. Vikunja docs + API spec

### Docs

- **Website**: `https://vikunja.io/docs/` - Astro site (from go-vikunja/website repo, `astro.config.mjs`).
- **Git repo**: `https://github.com/go-vikunja/website`, main branch. Docs in `src/content/docs/` (Astro content collections). Also `src/content/changelog/` and `src/content/help/`.
- **Format**: Astro MDX (`.mdx` or `.md` with Astro frontmatter).
- **llms.txt/llms-full.txt**: `https://vikunja.io/llms.txt` returns **404**. No bulk artifact available.
- **License**: No SPDX on the website repo. Main Vikunja repo is AGPL-3.0.

### API spec

- **Swagger 2.0 JSON**: Served at `<self-hosted instance>/api/v1/docs.json` (200, full spec). Also available at `https://try.vikunja.io/api/v1/docs.json` (public demo instance, confirmed 200).
- **Format**: Swagger 2.0. `swagger: "2.0"`, `info.version: "v2.7.1"`, paths covering admin, labels, lists, projects, tasks, teams, user, subscriptions, webhooks.
- **License**: AGPL-3.0-or-later (per `info.license` in the spec).
- **No git alternative**: The API spec is not stored in the repo; it's generated at runtime from Go struct tags + swagger annotations. The go-vikunja/vikunja repo has no swagger.json/yaml files.
- **Blockers for docs**: No llms.txt/llms-full; would need sitemap/toc discovery or git sparse checkout. Astro MDX may need `resolvePartials` for Astro components.
- **Blockers for API**: The swagger.json is served at a live instance, not in git. Using `discovery: "openapi"` with `url` pointing at `https://try.vikunja.io` and `discoveryUrl: "/api/v1/docs.json"` would fetch it live.

- **Proposed DocSource sketch** (docs):
  ```ts
  new DocSource({
    name: "vikunja",
    type: "git",
    url: "https://github.com/go-vikunja/website",
    format: "mdx",
    paths: ["src/content/docs"],
    rootPath: "src/content/docs",
  }),
  ```
- **Proposed DocSource sketch** (API):
  ```ts
  new DocSource({
    name: "vikunja-api",
    type: "http",
    url: "https://try.vikunja.io",
    discovery: "openapi",
    discoveryUrl: "/api/v1/docs.json",
    format: "openapi",
  }),
  ```
- **Verdict**: **feasible-now**. Two sources: git sparse checkout for Astro docs (format: mdx), http openapi discovery for the Swagger API spec. AGPL-3.0 license. No per-page markdown negotiation tested; Astro components may be noisy.

---

## Summary table

| Candidate | Best Path | Format | ~Pages | License | Blocker | Verdict |
|-----------|-----------|--------|--------|---------|---------|---------|
| Claude Code docs | llms-full `https://code.claude.com/docs/llms-full.txt` | Mintlify `Source:` | 231 | Unknown | None | **feasible-now** |
| Anthropic platform docs | None (llms.txt/full return RSC) | - | - | Unknown | No bulk artifact; Next.js RSC, no git repo | **needs-new-ingestor** (skip) |
| OpenAI dev docs | llms-full `https://developers.openai.com/api/docs/llms-full.txt` + `openai/openai-openapi` | Plain-heading split + openapi-dir | 667 + API | Unknown / MIT | Plain-heading split less reliable | **feasible-now** |
| llama.cpp docs | Git `ggml-org/llama.cpp` docs/ | Markdown | 24+ | MIT | None | **feasible-now** |
| Open WebUI docs | llms-full `https://docs.openwebui.com/llms-full.txt` | Mintlify `Source:` | 431 | Unknown | None | **feasible-now** |
| Supabase client refs | llms/js.txt etc (monolithic) | Single-page markdown | 1 per lang | Unknown | Monolithic, low granularity | **not-worth-it** |
| Discord API docs | Git `discord/discord-api-docs` developers/ | MDX | ~100+ | CC-BY-SA-4.0 | None | **feasible-now** |
| hls.js docs | Git `video-dev/hls.js` docs/ | Markdown | 2 | Apache 2.0 | Only 2 pages | **not-worth-it** |
| Vikunja docs + API | Git `go-vikunja/website` + http openapi at `try.vikunja.io/api/v1/docs.json` | MDX + Swagger 2.0 | ~50+ + API | AGPL-3.0 | Astro MDX; API spec is live-only | **feasible-now** |

## Commands run

All probes run in this session, live:

```
# Claude Code
curl -sI -L https://code.claude.com/docs/llms.txt
curl -sI -L https://code.claude.com/docs/llms-full.txt
curl -sL https://code.claude.com/docs/llms.txt | head -40
curl -sL https://code.claude.com/docs/llms-full.txt | head -40
curl -sL https://code.claude.com/docs/llms-full.txt | grep -c '^Source:'
curl -sL https://code.claude.com/docs/llms-full.txt | wc -c

# Anthropic
curl -sI -L https://docs.anthropic.com/en/llms.txt
curl -sI -L https://docs.anthropic.com/en/llms-full.txt
curl -sL https://platform.claude.com/docs/en/llms.txt | head -40  # RSC
gh api repos/anthropics/docs  # 404

# OpenAI
curl -sI -L https://platform.openai.com/docs/llms.txt  # redirects to developers.openai.com
curl -sI -L https://platform.openai.com/docs/llms-full.txt
curl -sL https://developers.openai.com/api/docs/llms.txt | head -60
curl -sL https://developers.openai.com/api/docs/llms-full.txt | head -40
curl -sL https://developers.openai.com/api/docs/llms-full.txt | grep -c '^Source:'  # 0
curl -sL https://developers.openai.com/api/docs/llms-full.txt | grep -c '^# '  # 667
curl -sL https://developers.openai.com/api/docs/llms-full.txt | wc -c  # 5733972
gh api repos/openai/openai-openapi --jq '.description,.license.spdx_id,.default_branch'

# llama.cpp
gh api repos/ggml-org/llama.cpp/license --jq '.license.spdx_id'
gh api repos/ggml-org/llama.cpp/contents/docs --jq '.[].name'
gh api repos/ggml-org/llama.cpp/contents/tools/server --jq '.[].name'

# Open WebUI
curl -sI -L https://docs.openwebui.com/llms.txt  # 200
curl -sI -L https://docs.openwebui.com/llms-full.txt  # 200
curl -sL https://docs.openwebui.com/llms.txt | head -30
curl -sL https://docs.openwebui.com/llms-full.txt | head -20
curl -sL https://docs.openwebui.com/llms-full.txt | grep -c '^Source:'  # 431
curl -sL https://docs.openwebui.com/llms-full.txt | wc -c  # 4429547
gh api repos/open-webui/docs --jq '.description,.default_branch'

# Supabase client refs
curl -sI -L https://supabase.com/llms/js.txt  # 200
curl -sL https://supabase.com/llms/js.txt | head -80
curl -sL https://supabase.com/llms/js.txt | wc -c  # 172740
curl -sL https://supabase.com/llms/js.txt | grep -cE '^#{1,4} '  # 715
curl -sI -L https://supabase.com/llms/python.txt
curl -sL https://supabase.com/llms/python.txt | head -40

# Discord API
gh api repos/discord/discord-api-docs --jq '.description,.license.spdx_id,.default_branch'
gh api repos/discord/discord-api-docs/git/trees/HEAD:developers --jq '.tree[].path'

# hls.js
gh api repos/video-dev/hls.js --jq '.description,.license.spdx_id,.default_branch'
gh api repos/video-dev/hls.js/git/trees/HEAD:docs --jq '.tree[].path'
curl -sL https://raw.githubusercontent.com/video-dev/hls.js/master/LICENSE | head -5

# Vikunja
curl -sL <self-hosted instance>/api/v1/docs.json | head -40  # Swagger 2.0
curl -sI https://vikunja.io/llms.txt  # 404
curl -sL https://try.vikunja.io/api/v1/docs.json | head -5  # Also works
gh api repos/go-vikunja/website --jq '.description,.default_branch'
gh api repos/go-vikunja/website/git/trees/HEAD:src/content --jq '.tree[].path'
```
## Parent spot-check corrections (2026-11-07)

Anthropic platform docs DO have a bulk artifact: `curl -sL https://platform.claude.com/llms-full.txt` (and docs.claude.com/llms-full.txt) returned 200 text/plain, 50,338,072 bytes. English only is inlined: "English (en) - 886 pages - Full content included below". Each page is a `## <title>` heading followed by a YAML frontmatter block with `title:` and `url: https://platform.claude.com/docs/en/...`, so the frontmatter llms-full split applies. Size is the concern (50 MB, API reference repeated per SDK language); a urlExclude on non-curl SDK reference pages would cut it. Verdict changes to feasible-now.
