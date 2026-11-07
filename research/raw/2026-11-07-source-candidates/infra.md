# docs-ssh Source Candidate Assessment - 2026-11-07

## Method
Live probes via `gh api`, `curl`, `webfetch`. Existing sources checked in `src/application/sources.ts`.

## Existing sources (from sources.ts, relevant to candidates)

| Source name | Type | URL | Format | Paths | files |
|---|---|---|---|---|---|
| jellyfin | git | github.com/jellyfin/jellyfin.org | markdown | docs/ | ~many |
| jellyseerr | git | github.com/fallenbagel/jellyseerr | mdx | docs/ | 45 |
| overseerr | git | github.com/sct/overseerr | markdown | docs/ | ~45 |

---

## 1. Frigate NVR

### Probes
```bash
gh api repos/blakeblackshear/frigate --jq '.license.spdx_id'  # MIT
gh api repos/blakeblackshear/frigate/git/trees/dev?recursive=1 \
  --jq '[.tree[] | select(.path | startswith("docs/docs/") and (endswith(".md") or endswith(".mdx")))] | length'  # 82
```

Sample content: Docusaurus .md with JSX component imports:
```md
import ConfigTabs from "@site/src/components/ConfigTabs";
import TabItem from "@theme/TabItem";
import NavPath from "@site/src/components/NavPath";

## Adding a camera with the Add Camera Wizard
The Add Camera Wizard is the recommended way to add a camera...
```

### Assessment
- **Format**: Docusaurus .md with JSX component imports. Not standard MDX - files are `.md` with React imports resolved at Docusaurus build time.
- **Files**: 82 markdown pages under `docs/docs/`
- **Repo**: github.com/blakeblackshear/frigate, branch dev
- **License**: MIT
- **Blocker**: Docusaurus JSX imports (`@site/src/components/*`, `@theme/*`) survive as raw noise. Body text is clean markdown after imports.
- **Proposed DocSource**:
  ```ts
  new DocSource({
    name: "frigate",
    type: "git",
    url: "https://github.com/blakeblackshear/frigate",
    format: "markdown",
    paths: ["docs/docs"],
    rootPath: "docs/docs",
    tags: ["media", "surveillance"],
    description: "Frigate NVR: camera configuration, detectors, zones, recordings",
  })
  ```
- **Verdict**: feasible-now - 82 clean pages; Docusaurus JSX imports are noise but don't block ingestion

---

## 2. Suricata

### Probes
```bash
gh api repos/OISF/suricata --jq '.license.spdx_id'  # GPL-2.0
gh api repos/OISF/suricata/git/trees/main?recursive=1 \
  --jq '[.tree[] | select(.path | startswith("doc/userguide/") and endswith(".rst"))] | length'  # 230
```
Files in `doc/userguide/`: Sphinx RST like `capture-hardware/af-packet.rst`, `configuration/index.rst`.

```bash
curl -sI https://docs.suricata.io/en/latest/sitemap.xml  # 404
curl -sI "https://docs.suricata.io/_/downloads/en/latest/htmlzip/"  # 200, 11MB zip
```
**htmlzip**: Single 4MB `index.html` (Sphinx singlehtml build) - not multi-page, not splittable.

### Assessment
- **Format**: Sphinx RST (reStructuredText) - **blocked**: no RST normaliser in docs-ssh.
- **Files**: 230 RST source files in git
- **Readthedocs**: Rendered HTML at docs.suricata.io. No sitemap. htmlzip is single-page. `toc` crawl from HTML pages is fragile.
- **Verdict**: needs-new-ingestor - 230 RST files require a new RST normaliser; htmlzip is single-page; toc crawl of readthedocs HTML is fragile

---

## 3. Vector

### Probes
```bash
gh api repos/vectordotdev/vector --jq '.license.spdx_id'  # MPL-2.0
# 214 MD/MDX pages under website/content/en/docs/
curl -sI https://vector.dev/llms.txt  # 404
```

Component reference pages generated from CUE:
```md
---
title: File
description: Collect logs from [files](https://en.wikipedia.org/wiki/File_system)
component_kind: source
layout: component
tags: ["file", "component", "source"]
---
{{/*
This doc is generated using CUE data in cue/reference/components/...
*/}}
```

### Assessment
- **Format**: Hugo .md - 214 pages, component reference generated from CUE but committed to git
- **Repo**: github.com/vectordotdev/vector, branch master
- **License**: MPL-2.0
- **Blocker**: Component ref pages are frontmatter-heavy with minimal body text; prose docs (administration, architecture) are substantial. No llms.txt.
- **Verdict**: feasible-now - 214 pages, Hugo .md works; component ref pages are thin but prose docs are good

---

## 4. Immich

### Probes
```bash
gh api repos/immich-app/immich --jq '.license.spdx_id'  # AGPL-3.0
# ~253 pages under docs/docs/ (mix .md/.mdx)
# Docusaurus (docusaurus.config.js)
# 8 MDX partials: docs/docs/partials/
```

Sample content: Docusaurus MDX with `@theme/Tabs`, `@mdi/react` imports, MDX partials.

### Assessment
- **Format**: Docusaurus MDX with JSX imports + shared partials
- **Files**: ~253 pages + 8 partials
- **Repo**: github.com/immich-app/immich, branch main
- **License**: AGPL-3.0
- **Blocker**: JSX imports survive as noise; partials (8 files) need `resolvePartials` (like supabase)
- **Verdict**: feasible-now - `resolvePartials` pattern exists; Docusaurus imports are noise but not blocker

---

## 5. darktable

### Probes
```bash
gh api repos/darktable-org/dtdocs --jq '.license.spdx_id'  # GPL-3.0
# 669 entries in content/ (across languages)
# Hugo site: config.yaml, multilingual (en, fr, de, eo, es, gl + more)
```

Sample content - clean Hugo markdown:
```md
---
title: darkroom view layout
id: the-darkroom-view
weight: 20
---
# left panel
[navigation](../module-reference/utility-modules/darkroom/navigation.md)
: Navigate and zoom the center view.
```

### Assessment
- **Format**: Hugo .md, clean markdown, no custom shortcodes observed
- **Files**: ~300-400 markdown pages across languages
- **Repo**: github.com/darktable-org/dtdocs, branch master
- **License**: GPL-3.0
- **Blocker**: Multilingual - ingest `content/en/` only to avoid complexity
- **Verdict**: feasible-now - clean Hugo markdown, English-only path works

---

## 6. Atuin

### Probes
```bash
gh api repos/atuinsh/atuin --jq '.license.spdx_id'  # MIT
# 53 .md files under docs/docs/ in main repo
# docs.atuin.sh: no llms.txt (404)
# atuinsh/docs repo: only README.md
```

Files: `docs/docs/ai/`, `docs/docs/configuration/`, `docs/docs/guide/`, `docs/docs/faq.md`.

### Assessment
- **Format**: Clean markdown in main repo
- **Files**: 53 pages
- **Repo**: github.com/atuinsh/atuin, branch main
- **License**: MIT
- **Blocker**: None
- **Verdict**: feasible-now - clean markdown, no partials or shortcodes

---

## 7. Seerr (jellyseerr/overseerr merger)

### Probes
```bash
gh api repos/seerr-team/seerr --jq '{archived, fork, license: .license.spdx_id}'
  # {archived:false, fork:false, license:"MIT"}
# 45 docs files
gh api repos/fallenbagel/jellyseerr --jq '{archived, fork, source.full_name}'
  # {archived:false, fork:false, source:null}
# 45 docs files
```

### Assessment
- **jellyseerr**: NOT archived, NOT a fork. 45 docs.
- **seerr**: Separate org (seerr-team), 45 docs, MIT. Claims to "unite Overseerr and Jellyseerr."
- **overseerr**: Existing source, 45 docs.
- **Recommendation**: Add `seerr` as new source; keep `jellyseerr` and `overseerr` until upstream deprecation.
- **Verdict**: feasible-now - add alongside existing sources

---

## 8a. Jellyfin OpenAPI

### Probes
```bash
curl -s https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json \
  | python3 -c "..."
# Title: Jellyfin API 12.4.0, 294 paths, License: None
```

### Assessment
- **Format**: OpenAPI 3.x JSON (1.9MB) - works with existing `discovery: "openapi"`
- **URL**: https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json
- **Verdict**: feasible-now - 294 endpoints, works with existing ingestor

---

## 8b. Jellyfin plugin development docs

### Probes
```bash
gh api repos/jellyfin/jellyfin.org/git/trees/HEAD?recursive=1 \
  --jq '.tree[] | select(.path | test("plugins")) | .path'
# Only 3 files: index.mdx, open-subtitles.md, tvheadend.md
```

Jellyfin plugin template: only README.md.

### Assessment
- Existing jellyfin source already covers these 3 plugin files
- No dedicated plugin development guide exists
- **Verdict**: not-worth-it - already covered by existing source

---

## 9. smallstep step-ca

### Probes
```bash
gh api repos/smallstep/docs --jq '.default_branch'  # main
# 344 MD/MDX files in flat directory structure
# step-ca/, step-cli/, certificate-manager/, ssh/, mtls/, etc.
```

### Assessment
- **Format**: Next.js MDX, flat directory (no content/ wrapper)
- **Files**: 344 pages
- **Repo**: github.com/smallstep/docs, branch main (no LICENSE file)
- **Blocker**: No focus to just step-ca - must ingest entire docs tree. MDX works with existing normaliser.
- **Verdict**: feasible-now - 344 MDX pages, flat directory works

---

## 10. Go libraries (godoc format)

### 10a. huma v2
- Repo: github.com/danielgtaylor/huma (MIT)
- `docs/docs/`: 43 .md pages - Docusaurus site, clean content
- **Verdict**: feasible-now via `format: "markdown"` - 43 pages better than godoc

### 10b. pgx v5
- Repo: github.com/jackc/pgx (MIT)
- 171 Go files, no docs/ dir - only README.md
- pgx.dev is Cloudflare Pages HTML, not in repo
- **Verdict**: needs-new-ingestor - godoc format needed; markdown docs not in repo

### 10c. goose v3
- Repo: github.com/pressly/goose (NOASSERTION license)
- 119 Go files, docs: README.md + doc/dialect-clickhouse.md + examples/README.md
- Minimal public API surface, thin docs
- **Verdict**: not-worth-it - minimal API, thin docs, `NOASSERTION` license

---

## Summary Table

| Candidate | Path | Format | ~Pages | License | Blocker | Verdict |
|---|---|---|---|---|---|---|
| Frigate | github.com/blakeblackshear/frigate docs/docs/ | Docusaurus .md | 82 | MIT | JSX import noise | feasible-now |
| Suricata | github.com/OISF/suricata doc/userguide/ | RST | 230 | GPL-2.0 | Needs RST normaliser | needs-new-ingestor |
| Vector | github.com/vectordotdev/vector website/content/en/docs/ | Hugo .md | 214 | MPL-2.0 | CUE-gen ref pages thin | feasible-now |
| Immich | github.com/immich-app/immich docs/docs/ | Docusaurus .mdx | ~253 | AGPL-3.0 | Partials + JSX imports | feasible-now |
| darktable | github.com/darktable-org/dtdocs content/en/ | Hugo .md | ~300-400 | GPL-3.0 | Multilingual (en-only fix) | feasible-now |
| Atuin | github.com/atuinsh/atuin docs/docs/ | Markdown | 53 | MIT | None | feasible-now |
| Seerr | github.com/seerr-team/seerr docs/ | MDX | 45 | MIT | None | feasible-now |
| Jellyfin API | api.jellyfin.org/openapi/ | OpenAPI 3.x | 294 paths | None | None | feasible-now |
| Jellyfin plugins | jellyfin/jellyfin.org docs/ | MDX | 3 | MIT | Already covered | not-worth-it |
| smallstep | github.com/smallstep/docs (flat) | MDX | 344 | No LICENSE | Must ingest whole tree | feasible-now |
| huma v2 | github.com/danielgtaylor/huma docs/docs/ | Docusaurus .md | 43 | MIT | None | feasible-now |
| pgx v5 | github.com/jackc/pgx | Godoc (Go) | 171 files | MIT | No markdown docs | needs-new-ingestor |
| goose v3 | github.com/pressly/goose | Godoc (Go) | 119 files | NOASSERTION | Thin API, no docs | not-worth-it |
## Parent spot-check corrections (2026-11-07)

Seerr: `gh api repos/fallenbagel/jellyseerr --jq .full_name` returns `seerr-team/seerr` - the jellyseerr repo was renamed/transferred to seerr-team/seerr (GitHub redirect), so the existing `jellyseerr` source already fetches Seerr's docs/. `gh api repos/sct/overseerr --jq .archived` = true. Action is a rename (jellyseerr -> seerr, url to seerr-team/seerr) and a decision on keeping the archived overseerr source, not a new source.
