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
];

/**
 * Sources allowed to be absent from the image while an upstream blocks the
 * fetch. The nightly fetch keeps trying them, so they return on their own
 * once unblocked; remove the entry then. Each entry needs a reason + date.
 */
export const TOLERATED_MISSING: Readonly<Record<string, string>> = {
  // akamai was here until 2026-10-19; its Bot Manager 403s came and went and
  // its 9.7k pages never fit a deadline, so the source was removed.
  archwiki:
    "wiki.archlinux.org resets TLS from our WAN IP since 2026-11-04 05:40Z after two full scrapes ~26h apart (Fly egress unaffected); now floored to 7d at concurrency 1 (docs-ssh#20)",
};
