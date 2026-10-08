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
  // Akamai Bot Manager answers 403 "Access Denied" to every techdocs URL,
  // llms.txt included, from both the router (CI) and dev-box IPs, with any
  // User-Agent - since the 2026-10-05 cold fetch (9.8k pages).
  akamai: "techdocs.akamai.com 403s our egress IPs (2026-10-05)",
};
