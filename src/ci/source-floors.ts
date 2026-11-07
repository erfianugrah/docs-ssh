/**
 * Per-source minimum file counts, shared by the pre-build docs gate
 * (src/ci/docs-gate.ts) and the post-deploy smoke test. Set to ~50% of the
 * typical count so transient page failures pass, while a wholesale upstream
 * break (AWS's 2026-04 llms.txt switch took it from 10k+ to 4 files;
 * cloudflare-blog's 2026-10-05 429 collapse left 397 of ~3600) trips.
 */
export const SOURCE_FLOORS: Readonly<Record<string, number>> = {
  supabase: 400,
  cloudflare: 4000,
  "cloudflare-blog": 3000,
  vercel: 1000,
  postgres: 700,
  // AWS is sharded per service (see sources.ts): the largest shard plus a
  // couple of mid-sized ones.
  "aws-lambda": 200,
  "aws-s3": 300,
  "aws-iam": 200,
  nextjs: 200,
  docker: 1000,
  kubernetes: 1000,
  mdn: 10000,
  terraform: 4000,
  react: 100,
  python: 300,
  typescript: 100,
  zsh: 10,
  sops: 1,
  openaq: 19,
  "openaq-api": 1,
  flyio: 400,
  bunnycdn: 300,
  "ietf-rfc": 5000,
  // Hardware security / MCU / fault injection (2026-11-01 batch).
  // ~50% of the measured full-fetch counts.
  "nuvoton-nusec": 8,
  "nuvoton-m480-bsp": 300,
  "nuvoton-tech-articles": 30,
  "openmouse-protocol": 30,
  "openmouse-docs": 4,
  "mouse-fw-re": 6,
  pyocd: 17,
  "probe-rs": 9,
  "fault-injection-library": 7,
  faultycat: 6,
  "hextree-faultier": 1,
  chipwhisperer: 60,
  // PCB design / fabrication (docs-ssh#18, 2026-11-04). ~50% of the
  // measured full-fetch counts.
  kicad: 4,
  "kicad-dev-docs": 27,
  "kicad-python": 2,
  freerouting: 14,
  jlcpcb: 120,
  libhmk: 2,
  "libhmk-src": 12,
  // Renamed from jellyseerr; no prior floor entry.
  seerr: 26,
  // -- batch w23-auspex (2026-11-07; insert this batch's entries below) --
  // ~65% of the measured full-fetch counts (see final report).
  build123d: 45,
  trimesh: 85,
  jlc3dp: 60,
  "ocp-vscode": 2,
  "kicad-druid": 4,
  platformio: 155,
  ezdxf: 110,
  "scikit-rf": 30,
  // -- end batch w23-auspex --

  // -- batch w24-batch1 (2026-11-07; insert this batch's entries below) --
  "claude-code": 140,
  frigate: 50,
  "jellyfin-api": 28,
  vector: 320,
  qmk: 120,
  "pid-codes": 600,
  ghidra: 120,
  "discord-api": 110,
  // -- end batch w24-batch1 --

  // -- batch w25-win32 (2026-11-07; insert this batch's entries below) --
  "win32-api": 1500,
  "win32-docs": 350,
  "windows-drivers": 470,
  "windows-ddi": 125,
  // -- end batch w25-win32 --

  // -- batch w26-batch2 (2026-11-07; insert this batch's entries below) --

  // immich: 87 Docusaurus MDX pages (not 253 - most tree entries were images/JSON)
  immich: 50,
  // darktable: 310 Hugo markdown pages → floor ~60%
  darktable: 185,
  // anthropic: 886 pages from llms-full → floor ~60%
  anthropic: 530,
  // openai: 577 pages from llms-full → floor ~60%
  openai: 350,
  // openai-api: 48 markdown files from openapi spec
  "openai-api": 30,
  // open-webui: blocked by ENAMETOOLONG in splitter; floor TBD after fix
  "open-webui": 1,
  // llama-cpp: 53 markdown files (docs/ subdirs only)
  "llama-cpp": 30,
  // atuin: 53 MkDocs markdown pages → floor ~60%
  atuin: 30,
  // huma: 43 Docusaurus markdown pages → floor ~60%
  huma: 25,
  // vikunja: Astro MDX docs, ~50 pages → floor ~60%
  vikunja: 30,
  // vikunja-api: Swagger 2.0 spec from live instance
  "vikunja-api": 1,

  // -- end batch w26-batch2 --

  // -- batch w27-svd (2026-11-07; insert this batch's entries below) --
  "nordic-nrf52840": 40,
  "nordic-nrf52820": 25,
  "artery-at32f405": 30,
  // -- end batch w27-svd --

  // -- batch w28-pdf (2026-11-07; insert this batch's entries below) --

  // CH32FV2x_V3xRM_en.PDF: ~1,000-page RM split into per-section .md.
  "wch-ch32v30x": 60,
  // HUT 1.5 (~200 pages) + HID 1.11 (~100 pages). ~50 sections each.
  "usb-hid-usage-tables": 60,
  // DS (~84 pages) + AN0185 EN + ZH. ~30 sections across all three.
  "at32f405": 20,

  // -- end batch w28-pdf --

  // -- batch w17-rst (2026-11-07; insert this batch's entries below) --
  suricata: 150,          // ~230 RST files (probe: 361 with _static etc.)
  mpv: 11,                 // 20 man-page RST files
  "faultier-python": 5,   // 7 docs/*.rst
  greatfet: 10,            // 17 .rst files
  // -- end batch w17-rst --

};

/** API-spec sources whose converted tree must contain api/overview.md. */
export const API_OVERVIEW_SOURCES: readonly string[] = [
  "cloudflare-api",
  "docker-api",
  "kubernetes-api",
  "supabase-api",
  "supabase-auth-api",
  "flyio-api",
  "gitea-api",
  "authentik-api",
  "keycloak-api",
  "openaq-api",
  "jellyfin-api",
  "openai-api",
  "vikunja-api",
];

/**
 * Sources allowed to be absent from the image while an upstream blocks the
 * fetch. The nightly fetch keeps trying them, so they return on their own
 * once unblocked; remove the entry then. Each entry needs a reason + date.
 */
export const TOLERATED_MISSING: Readonly<Record<string, string>> = {
  // (empty) akamai was here until 2026-10-19; its Bot Manager 403s came and
  // went and its 9.7k pages never fit a deadline, so the source was removed.
  // archwiki was here 2026-11-05 (wiki IP block) until it moved to the
  // arch-wiki-docs package the same day (docs-ssh#21).
};
