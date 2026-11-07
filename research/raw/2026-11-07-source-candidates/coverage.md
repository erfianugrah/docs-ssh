# Source candidates - coverage ledger (2026-11-07)

Status: untested | checked | eliminated. Demand cites demand.md (query-log
misses, agent web fetches, web-search queries) or the repo/stack that uses the
thing. Evidence files: hw.md, windows.md, ai-dev.md, infra.md (worker dumps,
each with parent corrections at the end). Items carded in docs-ssh#23
(build123d, PyVista, trimesh, JLC3DP, AT32F405, OCP viewer, kicad-druid,
PlatformIO, ezdxf, scikit-rf) are out of scope.

| candidate | demand | status | evidence |
| --- | --- | --- | --- |
| Nordic nRF52820/nRF52840 PS (HTML/PDF) | 41 searches, 7 fetches, ~68 web queries | eliminated (for http) | docs.nordicsemi.com and docs-be PDF links all 403 Cloudflare "Just a moment" (curl, 2026-11-07) |
| Nordic nRF52820/52840 SVD (nrfx bsp/stable/mdk) | same | checked | nrf52840 SVD is 2,327,129 bytes, 85 peripherals, 987 registers with field descriptions, BSD-3-Clause; needs an svd converter |
| nRF Connect SDK docs | same | eliminated (for now) | RST (hw.md) |
| WCH CH32V30x RM | ~70 web queries | eliminated | PDF-only on a JS site (hw.md); no SVD in openwch/ch32v307 tree |
| wlink docs | 3 searches | checked | 10 md, thin (hw.md) |
| pid.codes | 13 raw fetches | checked | 1702 md, CC0 (hw.md) |
| usb.ids | hidlab | eliminated | one 730 KB text file, low value (hw.md) |
| USB HID Usage Tables | hidlab | eliminated | PDF-only (hw.md) |
| Ghidra help topics | 15 web queries, 3 searches | checked | 137 .htm JavaHelp, Apache-2.0 (hw.md) |
| QMK firmware docs | qmk_userspace repo | checked | 208 md, GPL-2.0 (hw.md) |
| USBPcap | 14 raw fetches | eliminated | no docs in repo (hw.md) |
| usbipd-win wiki | 1 search | checked | 10 md, thin (hw.md) |
| Win32 API subset (sdk-api) | 20 fetches, 15 searches | checked | setupapi 386, cfgmgr32 259, winreg 91, winsvc 96, winusb 34, pdh 113, audioclient 73, mmdeviceapi 44 (parent gh api); CC-BY-4.0 |
| Win32 conceptual (Core Audio) | 17 wasapi queries | checked | 504 md subset (windows.md) |
| Windows driver docs audio+HID + DDI HID | 6 fetches | checked | 733 + 203 md; DDI holds HidD_/HidP_ (windows.md) |
| HA companion app docs | 6 searches | checked | 57 md, CC-BY-NC-SA-4.0 (windows.md) |
| mpv manual | 3 greps | eliminated (for now) | RST (windows.md) |
| Claude Code docs | 26 fetches, 20 queries | checked | llms-full, 231 Mintlify `Source:` pages (parent: rg -c) |
| Anthropic platform docs | 4 queries | checked | llms-full 50 MB, 886 en pages, frontmatter `url:` split (parent curl) |
| OpenAI developer docs | 7 queries | checked | llms-full 667 pages + openai-openapi (ai-dev.md) |
| llama.cpp docs | llmc | checked | ~24 md, MIT (ai-dev.md) |
| Open WebUI docs | llm-compose | checked | llms-full 431 Mintlify pages (ai-dev.md) |
| Supabase client refs (llms/js.txt) | 3 searches | eliminated (for now) | one monolithic file per language (ai-dev.md) |
| Discord API docs | 10 queries; discordctl | checked | ~100 mdx, CC-BY-SA-4.0 (ai-dev.md) |
| hls.js docs | 3 searches | eliminated | 2 pages (ai-dev.md) |
| Vikunja docs + API | vkctl/veans | checked | website mdx + Swagger 2.0 docs.json (ai-dev.md) |
| Frigate | 10 fetches, 8 searches | checked | 82 md, MIT (infra.md) |
| Suricata | 5 searches; runs on router | eliminated (for now) | RST; readthedocs htmlzip is one singlehtml page (infra.md) |
| Vector | 3 searches; runs on router | checked | 214 md, CUE-generated reference pages thin (infra.md) |
| Immich | 5 fetches, 7 queries | checked | ~253 mdx, partials (infra.md) |
| darktable manual | 11 fetches | checked | ~300-400 Hugo md, en-only path (infra.md) |
| Atuin | atuin repo + compose | checked | 53 md, MIT (infra.md) |
| Seerr | servarr-compose | checked | jellyseerr repo redirects to seerr-team/seerr; overseerr archived (parent gh api) |
| Jellyfin OpenAPI | 40 queries; lockstep, fladder | checked | api.jellyfin.org stable JSON, 294 paths (infra.md) |
| smallstep docs | certgen | checked | 344 mdx, no LICENSE file (infra.md) |
| huma v2 docs | 2 repos | checked | 43 md, MIT (infra.md) |
| pgx v5 / goose v3 (godoc) | go.mod usage | eliminated | no markdown; LSP covers library APIs (infra.md) |
| SVDs for CH32V307 / AT32F405 / M480 | hidlab | untested | not in openwch/ch32v307 or OpenNuvoton/M480BSP trees; vendor packs not checked |
