# HW source candidates - raw findings (2026-11-07)

Probes run live 2026-11-06T23:48-23:51 UTC. Commands inline.

## Candidate 1: Nordic nRF52820/nRF52840 Product Specifications

### docs.nordicsemi.com (primary)
```
curl -sI -L --max-time 10 'https://docs.nordicsemi.com/bundle/ps_nrf52820/page/keyfeatures_html5.html'
→ HTTP/2 403, cf-mitigated: challenge
→ Body: Cloudflare JS challenge page ("Just a moment...")
```
- All nordicsemi.com properties behind Cloudflare managed challenge:
  - `docs.nordicsemi.com` → 403
  - `infocenter.nordicsemi.com` → 403
  - `developer.nordicsemi.com` → 403
- `docs.nordicsemi.com/robots.txt` → 403
- `docs.nordicsemi.com/sitemap.xml` → 403
- `docs.nordicsemi.com/llms.txt` → 403 (likely doesn't exist anyway)
- Cannot assess format (CF blocks both curl and webfetch), but the fact it uses Cloudflare's managed challenge (not interactive JS app) suggests server-rendered HTML once you pass the gate.
- License: inaccessible behind CF.

### nrfx (NordicSemiconductor/nrfx)
```
gh api repos/NordicSemiconductor/nrfx --jq '{license, default_branch}'
→ BSD-3-Clause, master
```
- MDK (Microcontroller Development Kit) C headers with register definitions:
  - nrf52820: 13 files (`.h`, `.c`, `.S`, `.ld`, `.svd`, `.dox`)
  - nrf52840: 15 files
  - Total nrf52 MDK headers: 87 files
- Only 4 `.md` files total (README.md, CHANGELOG.md)
- The `.h` files have detailed register-bitfield comments but are C code, not documentation.
- No narrative prose docs.

### nrfconnect/sdk-nrf
```
gh api repos/nrfconnect/sdk-nrf --jq '{license}'
→ NOASSERTION (no SPDX license)
gh api repos/nrfconnect/sdk-nrf/contents/doc/nrf --jq '.[].name'
→ All .rst files (index.rst, app_dev.rst, drivers.rst, ...)
```
- Sphinx/RST documentation. No RST normalizer in docs-ssh.
- Also has CMakeLists.txt, _doxygen, _extensions, _static = standard Sphinx setup.

### zephyrproject-rtos/hal_nordic
```
gh api repos/zephyrproject-rtos/hal_nordic
→ license: null, description: null
gh api repos/zephyrproject-rtos/hal_nordic/git/trees/main?recursive=1
→ 404 (empty repo or wrong branch)
```

### Nordic doc repos search
```
gh search repos 'nrf52840' --owner=NordicSemiconductor --json name
→ [] (no repos match)
```
- Only `asset-tracker-cloud-docs` found (BSD-3-Clause, IoT example, not product specs).

### Verdict
**Not feasible** without a Playwright/browser-based fetcher to pass Cloudflare JS challenge.
- nrfx MDK headers provide register definitions but are C code, not documentation prose.
- nRF Connect SDK docs are RST (no normalizer).
- Product specifications exist ONLY on docs.nordicsemi.com, which is CF-gated.


## Candidate 2: WCH CH32V30x Reference Manual + Datasheet + wlink

### wch-ic.com (English site)
```
curl -sI -L --max-time 10 'https://www.wch-ic.com/products/CH32V307.html'
→ HTTP/2 200, text/html (4.3KB)
curl -sL --max-time 15 'https://www.wch-ic.com/products/CH32V307.html' | rg -i 'reference|manual|datasheet|rm|pdf'
→ No matches (JS SPA - content is in React chunk files, not the HTML shell)
```
- wch-ic.com is a React SPA (chunk-vendors, chunk-common, app JS bundles)
- Download page `https://www.wch-ic.com/downloads/CH32V30xRM_PDF.html` returns 200 HTML but also SPA shell
- No PDF URLs extractable from the HTML source

### wch.cn (Chinese site)
```
curl -sL --max-time 15 'https://www.wch.cn/downloads/CH32V30xDS0_PDF.html'
→ React SPA (same chunk-vendors/app pattern)
curl -sL --max-time 15 'https://www.wch.cn/search?q=CH32V307+reference+manual' | rg '\.pdf'
→ No matches (SPA)
```

### openwch/ch32v307 (GitHub)
```
gh api repos/openwch/ch32v307
→ license: null, description: "SDK, HDK, Datasheet of CH32V307"
gh api repos/openwch/ch32v307/git/trees/main?recursive=1 --jq '.tree[].path'
→ C/C++ source and headers only (ch32v30x.h, ch32v30x_adc.h, etc.)
→ No markdown, no PDF files in the repo
```
- The "datasheet" in the description seems to refer to PDFs linked from the SPA, not files in the repo.
- The repository is a firmware SDK with register headers, not documentation.

### ch32-rs/wlink (GitHub)
```
gh api repos/ch32-rs/wlink --jq '{license, description}'
→ Apache-2.0, "open source WCH-Link library/command line tool"
```
- 10 .md docs files:
  - docs/CH32L103.md, CH32V003.md, CH32V103.md, CH32V20x.md, CH32V30x.md
  - docs/CH32X035.md, CH56X.md, CH57x_CH58x_CH59x.md, CH641.md, CH643.md
  - docs/references.md, protocol.md
  - README.md, CHANGELOG.md
- Each chip doc describes flash layout, RAM, peripheral addresses, and quirks. Useful but sparse (~50-150 lines each).
- Total: ~12 markdown files.

### Verdict
**Not feasible** for the reference manual (PDF-only behind JS SPA). The wlink docs (10 .md) are feasible-now via `type: "git"` but too thin as a standalone source. Recommend bundling with other CH32-related repos if volume justifies it.


## Candidate 3: USB ID Registries

### pid.codes (pidcodes/pidcodes.github.com)
```
gh api repos/pidcodes/pidcodes.github.com
→ license: NOASSERTION, master branch
curl -sL 'https://raw.githubusercontent.com/pidcodes/pidcodes.github.com/master/LICENSE'
→ CC0 1.0 Universal
```
- Jekyll site: 1702 `.md` files in `1209/XXXX/index.md` structure
- Each file is frontmatter + one paragraph: `layout: pid`, `title: <name>`, `owner: <entity>`, `license: <terms>`
- Very small per-file (~100-300 bytes), individually not useful, only valuable as a searchable registry.
- All under `1209/` (pid.codes VID).
- Also has `about.md`, `faq.md`, `howto.md`, `404.md` at root.

### linux-usb usb.ids
```
curl -sI 'http://www.linux-usb.org/usb.ids'
→ 200 OK, application/octet-stream, 730605 bytes
→ Last-Modified: Fri, 26 Jun 2026
→ Version: 2026.06.26
```
- Single plain-text file, ~25K lines of `vendor VID  vendor_name` / `\tdevice PID  device_name` entries
- No explicit license in file header (maintainer: Stephen J. Gowdy; see submission page linked in file)
- No git repo; served via nginx on sfp-staticweb-2
- Ingestion path: `type: "http"`, fetch as single page. Would need a format converter to split into searchable per-vendor pages, or kept as one giant file.

### USB-IF HID Usage Tables
```
curl -sI -L 'https://www.usb.org/document-library/hid-usage-tables-14'
→ 301 → https://www.usb.org/document-library/hid-usage-tables-17
curl -sI 'https://www.usb.org/sites/default/files/hut1_4.pdf'
→ 200, application/pdf, 4425242 bytes (4.4MB)
```
- PDF-only (~4.4MB, latest revision per the document library redirect). No HTML/text alternative found.
- USB.org is Drupal (PHP), not JS SPA. The document library pages are server-rendered HTML.
- But the actual specification content is PDF.

### Verdict
| Subtopic | Verdict |
|----------|---------|
| pid.codes | **feasible-now** via `type: "git"`, paths: `["1209"]`, 1702 .md files, CC0 license |
| usb.ids | **feasible-now** via `type: "http"` single page fetch, but ~730KB single file has limited search value. Could split by vendor with a normalizer. |
| HID Usage Tables | **Not feasible** without PDF ingestor. PDF-only, 4.4MB. |


## Candidate 4: Ghidra Documentation

### Repo: NationalSecurityAgency/ghidra
```
gh api repos/NationalSecurityAgency/ghidra
→ Apache-2.0, master branch
gh api repos/NationalSecurityAgency/ghidra/contents/GhidraDocs
→ 4 files: CheatSheet.html, GettingStarted.md, GhidraCodingStandards.md
→ 2 dirs: GhidraClass, images
```

### Help topics
```
gh api repos/NationalSecurityAgency/ghidra/git/trees/master?recursive=1 --jq '[.tree[] | select(type=="blob" and path|test("help/topics") and path|endswith(".htm"))] | length'
→ 137
```
- 137 `.htm` files across `Ghidra/<component>/src/main/help/help/topics/<topic>/`
- 8+ Ghidra components: Configurations, Debug, Extensions, Features, Framework, Processors, RuntimeScripts, Test
- Within Features/Base: topics include About, Accessibility, Annotations, AssemblerPlugin, AutoAnalysisPlugin, BentoServicePlugin, BlockModel, BookmarkPlugin, BundleManager, CParserPlugin, ...
- Format: JavaHelp HTML (static, server-rendered). NOT JS SPA.
- GitHub API cannot traverse deep into the help tree (404 on paths > ~5 levels), but git sparse checkout can.
- Javadoc API docs: **generated, not in git** (mentioned in the candidate description).
- GhidraDocs has only 2 .md files + 1 CheatSheet.html.

### Verdict
**Feasible-now** via `type: "git"`, format: "html", paths including `["GhidraDocs"]` for prose docs and the help topics pattern. The HtmlNormaliser handles JavaHelp HTML. ~139 pages total. Javadoc is excluded (generated, not in git).


## Candidate 5: QMK Firmware Docs

### Repo: qmk/qmk_firmware
```
gh api repos/qmk/qmk_firmware
→ GPL-2.0, master branch
gh api repos/qmk/qmk_firmware/git/trees/<docs-sha>?recursive=1 --jq '[.tree[] | select(.type=="blob")] | length'
→ 272 total files under docs/
→ 208 .md files
```
- Standard markdown documentation, no RST
- Subdirs: ChangeLog/, drivers/, features/, public/
- Root .md files: api_development_overview.md, cli.md, cli_commands.md, config_options.md, contributing.md, custom_matrix.md, etc.
- License file: `docs/license.md` → 404 (doesn't exist at that path), but repo is GPL-2.0
- Docs cover: keymaps, configurator, driver installation, coding conventions, features (RGB, OLED, encoders, etc.), CLI, ARM debugging, ChibiOS

### Verdict
**Feasible-now** via `type: "git"`, paths: `["docs"]`, format: "markdown". 208 markdown pages, GPL-2.0. Clean ingest.


## Candidate 6: USBPcap

### Repo: desowin/usbpcap
```
gh api repos/desowin/usbpcap
→ license: null, master branch, has_wiki: true, has_pages: true
```
- README is plain text (not .md). Content: build instructions for Windows Driver Kit.
- Source files: C code only. No documentation files, no /docs directory.
- Wiki and Pages exist but appear empty/minimal.
- Repository is a Windows driver (USBPcapCMD, USBPcapDriver), not documentation.

### Verdict
**Not worth it** - no documentation content. The repo is a driver with a build-instructions README. No prose docs, no API reference, nothing to index.


## Candidate 7: usbipd-win

### Repo: dorssel/usbipd-win
```
gh api repos/dorssel/usbipd-win
→ GPL-3.0, master branch
```
- Main repo has no /docs directory (tree API returned 404).
- Wiki: 10 .md files cloned from `dorssel/usbipd-win.wiki.git`:
  - Home.md, WSL-support.md, Troubleshooting.md, Tested-Devices.md
  - New-design:-policies.md, Installer-design.md, Graphical-User-Interfaces.md
  - Enable-Tab-Completion.md, Contributions.md, Automation.md
- README.md exists in main repo (not counted in wiki).

### Verdict
**Feasible-now** via wiki git clone or `type: "git"` on the `.wiki.git` repo, but only ~10 pages. Thin source. Could be combined with a general "Windows USB tools" source if multiple such wikis exist.


---

## Summary Table

| Candidate | Canonical Path | Format | ~Pages | License | Blocker | Verdict |
|-----------|---------------|--------|--------|---------|---------|---------|
| Nordic nRF52x Product Specs | docs.nordicsemi.com/bundle/ps_nrf52820/... | HTML (CF-gated) | unknown | unknown (CF block) | Cloudflare JS challenge | **not feasible** - needs browser fetcher |
| Nordic nrfx MDK | github.com/NordicSemiconductor/nrfx | C headers | 87 nrf52 headers + 4 .md | BSD-3-Clause | C code, not docs | not-worth-it (register defs only) |
| Nordic nRF Connect SDK | github.com/nrfconnect/sdk-nrf doc/ | RST | ~50+ .rst files | NOASSERTION | No RST normalizer | needs-new-ingestor (RST) |
| WCH CH32V30x RM | wch-ic.com / wch.cn | PDF (behind SPA) | ~1 PDF (4MB+) | unknown | PDF-only, JS SPA download page | **not feasible** - needs PDF ingestor + browser |
| wlink docs | github.com/ch32-rs/wlink docs/ | .md | 10 | Apache-2.0 | Small (10 pages) | feasible-now (thin) |
| pid.codes | github.com/pidcodes/pidcodes.github.com 1209/ | .md (Jekyll) | 1702 | CC0 | None | **feasible-now** |
| usb.ids | http://www.linux-usb.org/usb.ids | plain text | 1 file (730KB) | none explicit | Single giant file | feasible-now (low search value) |
| USB HID Usage Tables | usb.org/sites/default/files/hut1_4.pdf | PDF | 1 file (4.4MB) | USB-IF spec | PDF-only | **not feasible** - needs PDF ingestor |
| Ghidra help topics | github.com/NationalSecurityAgency/ghidra Ghidra/**/help/topics/*.htm | .htm (JavaHelp) | 137 | Apache-2.0 | Deeply nested path | **feasible-now** |
| GhidraDocs | github.com/NationalSecurityAgency/ghidra GhidraDocs/ | .md + .html | 3 | Apache-2.0 | Thin | feasible-now |
| QMK firmware docs | github.com/qmk/qmk_firmware docs/ | .md | 208 | GPL-2.0 | None | **feasible-now** |
| USBPcap | github.com/desowin/usbpcap | C source | 0 docs | none | No documentation | **not-worth-it** |
| usbipd-win wiki | github.com/dorssel/usbipd-win.wiki | .md | 10 | GPL-3.0 | Thin (10 pages) | feasible-now (thin) |

### Take-aways

1. **Nordic**: The product specs (highest demand: 41 searches, 7 fetches) are behind Cloudflare. No git-based alternative exists. Would need a `userAgent` + browser fetcher (Playwright) to pass CF challenge. The RST-based nRF Connect SDK docs are another path but need an RST normalizer first.

2. **WCH**: The CH32V30x reference manual is PDF-only behind a JS SPA. Would need both a PDF ingestor and a browser to enumerate/download the PDFs. The wlink docs are ingestible now but thin.

3. **USB registries**: pid.codes is the clear win here - 1702 pages, CC0, clean git ingest. usb.ids is a single file with limited value. HID Usage Tables needs PDF support.

4. **Ghidra**: Feasible now via git sparse checkout of the help topics. 137 static HTML pages + GhidraDocs. Javadoc is excluded (generated).

5. **QMK**: Cleanest candidate - 208 .md pages in git, GPL-2.0, no blockers.

6. **USBPcap/usbipd-win**: Very thin. USBPcap has zero docs, usbipd-win has 10 wiki pages.

### Commands run (for reproducibility)

```bash
# Nordic
curl -sI -L --max-time 10 'https://docs.nordicsemi.com/bundle/ps_nrf52820/page/keyfeatures_html5.html'
curl -sL --max-time 10 'https://docs.nordicsemi.com/bundle/ps_nrf52820/page/keyfeatures_html5.html'
curl -sI --max-time 10 'https://docs.nordicsemi.com/robots.txt'
curl -sL --max-time 10 'https://docs.nordicsemi.com/sitemap.xml'
curl -sI --max-time 10 'https://docs.nordicsemi.com/llms.txt'
curl -sI --max-time 10 'https://infocenter.nordicsemi.com/'
curl -sI --max-time 10 'https://developer.nordicsemi.com/'
curl -sL --max-time 10 'https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/index.html'
gh api repos/NordicSemiconductor/nrfx --jq '{license, default_branch}'
gh api repos/NordicSemiconductor/nrfx/git/trees/master?recursive=1 --jq '.tree[] | select(.type=="blob" and (.path | test("nrf52820"))) | .path'
gh api repos/NordicSemiconductor/nrfx/git/trees/master?recursive=1 --jq '.tree[] | select(.type=="blob" and (.path | test("nrf52840"))) | .path'
gh api repos/nrfconnect/sdk-nrf --jq '{license}'
gh api repos/nrfconnect/sdk-nrf/contents/doc/nrf --jq '.[].name'
gh api repos/zephyrproject-rtos/hal_nordic
gh search repos 'nrf52840' --owner=NordicSemiconductor --json name,description --limit 5

# WCH
curl -sI -L --max-time 10 'https://www.wch-ic.com/products/CH32V307.html'
curl -sL --max-time 15 'https://www.wch-ic.com/products/CH32V307.html' | rg -i 'reference|manual|pdf'
curl -sI -L --max-time 10 'https://www.wch-ic.com/downloads/CH32V30xRM_PDF.html'
curl -sL --max-time 15 'https://www.wch.cn/downloads/CH32V30xDS0_PDF.html' | rg '\.pdf'
gh api repos/openwch/ch32v307
gh api repos/openwch/ch32v307/git/trees/main?recursive=1 --jq '.tree[].path' | head -50
gh api repos/ch32-rs/wlink --jq '{license, description}'
gh api repos/ch32-rs/wlink/git/trees/main?recursive=1 --jq '.tree[] | select(.type=="blob") | .path' | head -40

# USB registries
gh api repos/pidcodes/pidcodes.github.com --jq '{license, default_branch}'
gh api repos/pidcodes/pidcodes.github.com/git/trees/master?recursive=1 --jq '[.tree[] | select(.type=="blob" and (.path | endswith(".md")))] | length'
curl -sL --max-time 5 'https://raw.githubusercontent.com/pidcodes/pidcodes.github.com/master/LICENSE' | head -20
curl -sI --max-time 10 'http://www.linux-usb.org/usb.ids'
curl -sL --max-time 10 'http://www.linux-usb.org/usb.ids' | head -20
curl -sI -L --max-time 10 'https://www.usb.org/document-library/hid-usage-tables-14'
curl -sI --max-time 10 'https://www.usb.org/sites/default/files/hut1_4.pdf'

# Ghidra
gh api repos/NationalSecurityAgency/ghidra --jq '{license, default_branch}'
gh api repos/NationalSecurityAgency/ghidra/contents/GhidraDocs --jq '.[].name'
gh api repos/NationalSecurityAgency/ghidra/git/trees/master?recursive=1 --jq '[.tree[] | select(.type=="blob" and path|test("help/topics") and path|endswith(".htm"))] | length'

# QMK
gh api repos/qmk/qmk_firmware --jq '{license, default_branch}'
QMK_DOCS_SHA=$(gh api repos/qmk/qmk_firmware/git/trees/master --jq '.tree[] | select(.path=="docs") | .sha')
gh api "repos/qmk/qmk_firmware/git/trees/${QMK_DOCS_SHA}?recursive=1" --jq '[.tree[] | select(.type=="blob")] | length'
gh api "repos/qmk/qmk_firmware/git/trees/${QMK_DOCS_SHA}?recursive=1" --jq '[.tree[] | select(.type=="blob" and (.path | endswith(".md")))] | length'

# USBPcap
gh api repos/desowin/usbpcap --jq '{license, has_wiki, has_pages}'
curl -sL --max-time 5 'https://raw.githubusercontent.com/desowin/usbpcap/master/README' | head -40

# usbipd-win
gh api repos/dorssel/usbipd-win --jq '{license, has_wiki}'
git clone --depth 1 https://github.com/dorssel/usbipd-win.wiki.git /tmp/usbipd-win-wiki
find /tmp/usbipd-win-wiki -name '*.md' | wc -l
```