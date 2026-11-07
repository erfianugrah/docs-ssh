# Which sources to add next (2026-11-07)

Survey of documentation the agents needed in the last ~30 days and could not
get from docs.erfi.io. Raw evidence: `research/raw/2026-11-07-source-candidates/`
(`demand.md` signals, `coverage.md` ledger, one feasibility dump per area).

## Demand signals

1. Query log (`/var/lib/docs-ssh/log/*.jsonl`, 2026-10-22 to 2026-11-07,
   6,565 ops): `docs_search` / `docs_grep` calls that named a source that does
   not exist. Top misses: nordic 33, lidarr 27, nuvoton-m480 14, nuvoton 12,
   windows-sdk 9, frigate 8, rfc 7, aws 7, nrf52840 6, microsoft 6,
   suricata 5, fly 4, vector 3, supabase-js 3, hlsjs 3, claude-code 3.
2. Agent web fetches by host in pi + Claude Code session files (3,382
   fetches): learn.microsoft.com 69 (20 under windows/win32/api), forgejo.org 37,
   code.claude.com 26, docs.darktable.org 11, docs.frigate.video 10,
   docs.nordicsemi.com 7, docs.immich.app 5.
3. 4,297 web-search queries from the same files, grepped per topic: ch32/wch
   ~70, nrf52 68, jellyfin 40, claude code 20, wasapi 17, ghidra 15,
   discord 10, frigate 7, immich 7, openai 7.
4. What runs: Suricata and Vector are live units on the router; immich,
   atuin, open-webui, seerr images in compose stacks; lockstep/fladder are
   Jellyfin work; qmk_userspace and hidlab are active repos.

Many "low coverage" searches are search-quality misses, not missing sources:
forgejo actions, kicad-cli, duckdb aggregates and transaction_timeout all
exist in the corpus but miss on title+summary keywords (docs-ssh#19 territory).

## Shortlist (feasible with existing ingestors)

| candidate | ingestion | ~pages | demand |
| --- | --- | --- | --- |
| claude-code | llms-full, Mintlify `Source:` | 231 | 26 fetches, 20 queries |
| win32 subset | git MicrosoftDocs/sdk-api: setupapi, cfgmgr32, winusb, winreg, winsvc, pdh, audioclient, mmdeviceapi (+ endpointvolume, audiopolicy, display config) | ~1,100 | 20 fetches, 15 searches |
| win32 Core Audio + driver HID | git MicrosoftDocs/win32 CoreAudio; windows-driver-docs(-ddi) audio + hid (HidD_/HidP_ live only in DDI) | ~700-1,400 | 17 wasapi queries |
| frigate | git blakeblackshear/frigate docs/docs | 82 | 10 fetches, 8 searches |
| jellyfin-api | openapi, api.jellyfin.org stable JSON | 294 paths | 40 queries |
| vector | git vectordotdev/vector website/content/en/docs | 214 | runs on router |
| qmk | git qmk/qmk_firmware docs | 208 | qmk_userspace |
| pid-codes | git pidcodes/pidcodes.github.com | 1,702 | 13 raw fetches |
| ghidra | git NSA/ghidra help topics (.htm) | 137 | 15 queries |
| discord-api | git discord/discord-api-docs | ~100 | discordctl, 10 queries |
| immich | git immich-app/immich docs/docs (mdx, partials) | ~253 | 5 fetches, 7 queries |
| darktable | git darktable-org/dtdocs content (en) | ~300-400 | 11 fetches |
| anthropic | llms-full, frontmatter `url:` split, 50 MB | 886 | 4 queries |
| openai | llms-full + openai-openapi | 667 + API | 7 queries |
| open-webui | llms-full, Mintlify | 431 | stack |
| llama-cpp | git ggml-org/llama.cpp docs | ~24 | llmc |
| atuin, huma | git docs dirs | 53, 43 | in use |
| vikunja | website mdx + Swagger docs.json | ~50 + API | vkctl/veans |
| seerr | rename `jellyseerr` (repo now redirects to seerr-team/seerr); overseerr is archived | 45 | maintenance |

## Eliminated, with the reason

- Nordic product specs over HTTP: docs.nordicsemi.com and its PDF links
  answer 403 with a Cloudflare challenge. The nRF52820/52840 SVD files in
  NordicSemiconductor/nrfx (BSD-3-Clause, 987 registers with field
  descriptions for the 52840) answer most of the logged questions, which ask
  for register offsets, INTENSET bits and interrupt numbers. Needs a new
  `svd` format converter.
- WCH CH32V30x reference manual, USB HID Usage Tables: PDF only. A PDF
  ingestor would also unlock the AT32F405 datasheets in docs-ssh#23.
- Suricata, mpv, nRF Connect SDK: RST sources; add to the RST normaliser
  case (docs-ssh#17). Suricata's readthedocs htmlzip is one singlehtml page.
- hls.js (2 pages), USBPcap (no docs), usb.ids (one text file), Supabase
  client llms/*.txt (one monolithic file per language), pgx/goose godoc
  (LSP covers library APIs), wlink and usbipd-win wikis (10 pages each).
- smallstep: feasible but the docs repo has no LICENSE file; hold.
- HA companion docs: feasible, CC-BY-NC-SA; low demand (6 searches).

## Tooling finding

108 logged calls named a source that does not exist but has a near
match: lidarr (servarr/lidarr-api), fly (flyio), nuvoton-m480
(nuvoton-m480-bsp), rfc (ietf-rfc), aws (aws-*), jlc (jlcpcb), supa
(supabase). An unknown `source=` currently returns nothing; suggesting the
closest names would recover those calls without adding content.
