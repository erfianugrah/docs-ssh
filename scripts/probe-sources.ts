/**
 * Per-source data-availability probe.
 *
 * For every source in sources.ts, probes which of the better-than-HTML
 * options actually exist:
 *
 *   - bulk archive (tarball/zip on the upstream)  [best: 1 fetch, no rendering]
 *   - llms-full.txt at the upstream root          [single-file dump]
 *   - llms.txt at the upstream root               [structured index]
 *   - known github repo with markdown docs        [pull from source]
 *
 * Output: TSV to stdout with per-source recommendations. Run with
 *
 *     pnpm tsx scripts/probe-sources.ts > probe-report.tsv
 */
import { SOURCES } from "../src/application/sources.js";

const TIMEOUT = 8_000;

interface Probe {
  source: string;
  current: string;
  llmsFull?: number; // bytes if found
  llmsTxt?: number;
  archive?: string; // path/url found
  github?: string; // known/derived repo
  recommendation: string;
}

async function head(url: string): Promise<{ ok: boolean; bytes?: number }> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false };
    const len = res.headers.get("content-length");
    return { ok: true, bytes: len ? parseInt(len, 10) : undefined };
  } catch {
    return { ok: false };
  }
}

/** Try a few common archive locations specific to known sites. */
async function probeArchive(source: { url: string; name: string }): Promise<string | undefined> {
  const guesses: string[] = [];
  const u = new URL(source.url);
  // Generic guesses
  guesses.push(`${u.origin}/docs.tar.gz`);
  guesses.push(`${u.origin}/docs/docs.tar.gz`);
  // Known specifics
  if (u.hostname === "docs.python.org") {
    // python provides versioned text archives
    guesses.push("https://docs.python.org/3/archives/python-3.14-docs-text.tar.bz2");
  }
  for (const g of guesses) {
    const r = await head(g);
    if (r.ok) return g;
  }
  return undefined;
}

/**
 * Try llms-full.txt then llms.txt at the source root and `/docs/`.
 */
async function probeLlms(source: { url: string }): Promise<{ full?: number; txt?: number }> {
  const out: { full?: number; txt?: number } = {};
  const base = new URL(source.url);
  const candidates = [base.origin, base.origin + base.pathname.replace(/\/$/, "")];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const fullUrl = `${candidate.replace(/\/$/, "")}/llms-full.txt`;
    const txtUrl = `${candidate.replace(/\/$/, "")}/llms.txt`;
    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      const r = await head(fullUrl);
      if (r.ok && (out.full === undefined || (r.bytes ?? 0) > out.full)) {
        out.full = r.bytes ?? 0;
      }
    }
    if (!seen.has(txtUrl)) {
      seen.add(txtUrl);
      const r = await head(txtUrl);
      if (r.ok && (out.txt === undefined || (r.bytes ?? 0) > out.txt)) {
        out.txt = r.bytes ?? 0;
      }
    }
  }
  return out;
}

/** Known repo overrides — for sources where the github repo is non-obvious. */
const KNOWN_REPOS: Record<string, string> = {
  // already migrated or known-good
  ansible: "https://github.com/ansible/ansible-documentation",
  argocd: "https://github.com/argoproj/argo-cd",
  cockroachdb: "https://github.com/cockroachdb/docs",
  cypress: "https://github.com/cypress-io/cypress-documentation",
  d2: "https://github.com/terrastruct/d2-docs",
  docker: "https://github.com/docker/docs",
  drizzle: "https://github.com/drizzle-team/drizzle-orm-docs",
  effect: "https://github.com/Effect-TS/website",
  electric: "https://github.com/electric-sql/electric",
  expo: "https://github.com/expo/expo",
  fastapi: "https://github.com/fastapi/fastapi",
  flutter: "https://github.com/flutter/website",
  gitea: "https://github.com/go-gitea/docs",
  gitlab: "https://github.com/gitlab-org/gitlab",
  go: "https://github.com/golang/website",
  grafana: "https://github.com/grafana/grafana",
  hono: "https://github.com/honojs/website",
  htmx: "https://github.com/bigskysoftware/htmx",
  jest: "https://github.com/jestjs/jest",
  k3s: "https://github.com/k3s-io/docs",
  keycloak: "https://github.com/keycloak/keycloak",
  letsencrypt: "https://github.com/letsencrypt/website",
  mise: "https://github.com/jdx/mise",
  multigres: "https://github.com/multigres/multigres",
  neovim: "https://github.com/neovim/neovim",
  nix: "https://github.com/NixOS/nix.dev",
  opencode: "https://github.com/sst/opencode",
  opentelemetry: "https://github.com/open-telemetry/opentelemetry.io",
  patroni: "https://github.com/patroni/patroni",
  playwright: "https://github.com/microsoft/playwright",
  pnpm: "https://github.com/pnpm/pnpm.io",
  prettier: "https://github.com/prettier/prettier",
  prisma: "https://github.com/prisma/docs",
  prometheus: "https://github.com/prometheus/docs",
  rclone: "https://github.com/rclone/rclone",
  redis: "https://github.com/redis/docs",
  resend: "https://github.com/resend/docs",
  rspack: "https://github.com/web-infra-dev/rspack",
  shadcn: "https://github.com/shadcn-ui/ui",
  sops: "https://github.com/getsops/sops",
  sqlite: "https://github.com/sqlite/sqlite",
  sst: "https://github.com/sst/sst",
  tauri: "https://github.com/tauri-apps/tauri-docs",
  turborepo: "https://github.com/vercel/turborepo",
  yugabytedb: "https://github.com/yugabyte/docs",
  zod: "https://github.com/colinhacks/zod",
};

async function probeOne(s: typeof SOURCES[number]): Promise<Probe> {
  const current = `${s.type}/${s.discovery}`;
  const out: Probe = { source: s.name, current, recommendation: "" };

  // Skip git sources — already best-case
  if (s.type === "git") {
    out.recommendation = "GIT (current — keep)";
    return out;
  }

  // Skip tarball/llms-full sources — already best-case
  if (s.discovery === "tarball" || s.discovery === "llms-full") {
    out.recommendation = `${s.discovery.toUpperCase()} (current — keep)`;
    return out;
  }

  const [archive, llms] = await Promise.all([probeArchive(s), probeLlms(s)]);
  if (archive) out.archive = archive;
  if (llms.full) out.llmsFull = llms.full;
  if (llms.txt) out.llmsTxt = llms.txt;

  // Recommend in priority order: llms-full > archive > github > current
  if (out.llmsFull) out.recommendation = `LLMS-FULL (${(out.llmsFull / 1024).toFixed(0)}KB)`;
  else if (out.archive) out.recommendation = `ARCHIVE (${out.archive})`;
  else if (KNOWN_REPOS[s.name]) out.recommendation = `GIT (${KNOWN_REPOS[s.name]})`;
  else if (out.llmsTxt) out.recommendation = `LLMS-TXT (${(out.llmsTxt / 1024).toFixed(0)}KB) — current may be better`;
  else out.recommendation = "KEEP-AS-IS";

  return out;
}

async function main() {
  console.error(`Probing ${SOURCES.length} sources…`);
  console.log(["source", "current", "llms_full", "llms_txt", "archive", "recommendation"].join("\t"));
  for (let i = 0; i < SOURCES.length; i++) {
    const s = SOURCES[i];
    process.stderr.write(`[${i + 1}/${SOURCES.length}] ${s.name}…\n`);
    try {
      const p = await probeOne(s);
      console.log([
        p.source,
        p.current,
        p.llmsFull ? `${(p.llmsFull / 1024).toFixed(0)}KB` : "",
        p.llmsTxt ? `${(p.llmsTxt / 1024).toFixed(0)}KB` : "",
        p.archive ?? "",
        p.recommendation,
      ].join("\t"));
    } catch (err) {
      console.log([s.name, `ERROR: ${err instanceof Error ? err.message : err}`, "", "", "", ""].join("\t"));
    }
  }
}

await main();
