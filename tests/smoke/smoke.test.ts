/**
 * Smoke tests against a live docs-ssh container.
 *
 * Requires: a running container on localhost:2222 (or DOCS_SSH_PORT).
 * Run: pnpm test:smoke
 *
 * These tests verify every source has files, the index is searchable,
 * API specs have resolved schemas, builtins work, and fixes are deployed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

const HOST = process.env.DOCS_SSH_HOST ?? "localhost";
const PORT = process.env.DOCS_SSH_PORT ?? "2222";
const SSH_OPTS = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5 -p ${PORT}`;

/**
 * Run an SSH command. Uses single-quoted wrapping to prevent local shell expansion.
 *
 * Retries on transient connection failures (Connection refused / reset / timed out)
 * up to 3 times with 2s backoff. The host-mode Caddy proxy that fronts :2222 can be
 * recreated by a cascade Composer job mid-test (e.g. after a docs-ssh deploy triggers
 * a sync_redeploy on caddy), opening a ~10s window where the listener is gone. The
 * release workflow waits for cascade jobs to settle before smoke, but this is cheap
 * insurance against any future unrelated blip (cert renewal, sshd reload, etc).
 */
function ssh(cmd: string): string {
  const fullCmd = `ssh ${SSH_OPTS} docs@${HOST} '${cmd.replace(/'/g, "'\\''")}'`;
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return execSync(fullCmd, {
        timeout: 15_000,
        encoding: "utf-8",
      }).trim();
    } catch (err) {
      lastErr = err;
      const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
      const out = `${e.stderr?.toString() ?? ""}${e.stdout?.toString() ?? ""}`;
      const transient = /Connection refused|Connection reset|Connection timed out|kex_exchange_identification/.test(out);
      if (!transient || attempt === maxAttempts) throw err;
      // Synchronous 2s backoff before retry (no async sleep available in execSync flow).
      execSync("sleep 2");
    }
  }
  throw lastErr;
}

/** Parse "name: count" lines into structured data. */
function parseSources(raw: string): Array<{ name: string; count: number }> {
  return raw
    .split("\n")
    .filter((l) => l.includes(":"))
    .map((l) => {
      const [name, rest] = l.split(":");
      const count = parseInt(rest.trim());
      return { name: name.trim(), count };
    })
    .filter((s) => !isNaN(s.count));
}

// ─── Discover sources from the live container ───────────────────────

let allSources: Array<{ name: string; count: number }> = [];
let docSources: Array<{ name: string; count: number }> = [];
let apiSources: Array<{ name: string; count: number }> = [];

beforeAll(() => {
  // Verify connectivity
  expect(ssh("echo ok")).toBe("ok");

  const raw = ssh(
    'for d in /docs/*/; do name=$(basename "$d"); count=$(find "$d" -type f | wc -l); echo "$name: $count"; done',
  );
  allSources = parseSources(raw);
  docSources = allSources.filter((s) => !s.name.endsWith("-api"));
  apiSources = allSources.filter((s) => s.name.endsWith("-api"));
}, 30_000);

// ─── Every source has files ─────────────────────────────────────────

describe("source file counts", () => {
  it("has at least 120 sources", () => {
    expect(allSources.length).toBeGreaterThanOrEqual(120);
  });

  it("no source has 0 files", () => {
    const empty = allSources.filter((s) => s.count === 0);
    expect(empty, `Empty sources: ${empty.map((s) => s.name).join(", ")}`).toHaveLength(0);
  });

  // Per-source minimum file counts (catches regressions). Set to ~50%
  // of typical observed counts so transient page-fetch failures don't
  // flake the test, but a wholesale upstream-format break (like AWS's
  // 2026-04 .html→.md llms.txt switch that took the source from 10k+
  // to 4 files) trips loud and clear.
  const expectedMinimums: Record<string, number> = {
    supabase: 400,
    cloudflare: 4000,
    "cloudflare-blog": 3000,
    vercel: 1000,
    postgres: 700,
    // AWS is sharded per-service (see sources.ts). Floor for the
    // largest individual shard plus a couple of mid-sized ones.
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
  };

  for (const [name, min] of Object.entries(expectedMinimums)) {
    it(`${name} has >= ${min} files`, () => {
      const source = allSources.find((s) => s.name === name);
      expect(source, `source "${name}" not found in: ${allSources.map((s) => s.name).join(", ")}`).toBeDefined();
      expect(source!.count).toBeGreaterThanOrEqual(min);
    });
  }
});

// ─── Search index ───────────────────────────────────────────────────

describe("search index", () => {
  it("index exists and has entries", () => {
    const count = ssh("wc -l < /docs/_index.tsv");
    expect(parseInt(count)).toBeGreaterThan(10000);
  });

  it("index has entries for every source with markdown content", () => {
    // build-index.sh only indexes *.md files. Sources that retain raw
    // HTML (e.g. JS-rendered upstreams where Turndown produces ~nothing
    // and HtmlNormaliser's safety net keeps the HTML) won't appear in
    // the index — that's by design, not a bug. Filter out HTML-only
    // sources before asserting.
    const raw = ssh(
      'for src in $(ls -1 /docs/ | grep -v _index); do '
        + 'mdcount=$(find "/docs/$src" -name "*.md" 2>/dev/null | wc -l); '
        + 'idxcount=$(rg -c "^$src/" /docs/_index.tsv 2>/dev/null || echo 0); '
        + 'echo "$src:$mdcount:$idxcount"; '
        + 'done',
    );
    const missing: string[] = [];
    for (const line of raw.split("\n")) {
      const [name, md, idx] = line.split(":");
      if (!name) continue;
      // Only complain when a source has .md files but no index entries.
      if (parseInt(md) > 0 && parseInt(idx) === 0) missing.push(name.trim());
    }
    expect(missing, `Sources with .md files but no index entries: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("enriched index: headings in summary field", () => {
    // Look for an actual RLS landing page entry, not just any page
    // that mentions row-level-security in passing. A real RLS doc has
    // the phrase in its title or first prose line, so we anchor on a
    // path containing 'row-level-security' as a basename.
    const entry = ssh("rg '/row-level-security\\.md\\t' /docs/_index.tsv | head -1");
    expect(entry).toMatch(/Row[ -]Level Security/);
    expect(entry.length).toBeGreaterThan(100);
  });

  it("search: row security finds postgres docs", () => {
    const results = ssh("rg -i 'row security' /docs/_index.tsv | rg '^postgres/'");
    expect(results).toContain("postgres/");
  });

  it("search: auth finds supabase docs", () => {
    const results = ssh("rg -i 'auth' /docs/_index.tsv | rg '^supabase/' | head -5");
    expect(results).toContain("supabase/");
  });

  it("search: workers finds cloudflare docs", () => {
    const results = ssh("rg -i 'workers' /docs/_index.tsv | rg '^cloudflare/' | head -5");
    expect(results).toContain("cloudflare/");
  });

  // ─── Frontmatter extraction ─────────────────────────────────────

  it("frontmatter: traefik descriptions in index", () => {
    const out = ssh("rg '^traefik/' /docs/_index.tsv | rg -i 'migrate' | head -3");
    expect(out).toContain("migrate");
    // Should have description text, not just headings
    expect(out.length).toBeGreaterThan(80);
  });

  it("frontmatter: kubernetes descriptions in index", () => {
    // kubernetes home _index.md has a multi-line description
    const out = ssh("rg '^kubernetes/home/_index.md' /docs/_index.tsv");
    expect(out).toContain("Kubernetes");
    expect(out).toContain("container");
  });

  it("frontmatter: mdn titles from frontmatter", () => {
    const out = ssh("rg '^mdn/web/css/index.md' /docs/_index.tsv");
    expect(out).toContain("CSS");
    // Should not leak frontmatter fields into summary
    expect(out).not.toContain("slug:");
    expect(out).not.toContain("page-type:");
  });

  it("frontmatter: no YAML field leakage in summary", () => {
    // Count index entries where summary column starts with "title:" (field leakage)
    const out = ssh("awk -F'\\t' '$3 ~ /^title:/' /docs/_index.tsv | wc -l");
    const count = parseInt(out.trim());
    // Allow very few (edge cases) but not widespread leakage
    expect(count, "title: field leaking into summary column").toBeLessThan(10);
  });
});

// ─── API specs ($ref resolution) ────────────────────────────────────

describe("API specs", () => {
  it("has at least 6 API sources", () => {
    expect(apiSources.length).toBeGreaterThanOrEqual(6);
  });

  for (const api of [
    "cloudflare-api",
    "docker-api",
    "kubernetes-api",
    "supabase-api",
    "supabase-auth-api",
    "flyio-api",
    "gitea-api",
    "authentik-api",
    "keycloak-api",
  ]) {
    it(`${api} has overview.md`, () => {
      const out = ssh(`test -f /docs/${api}/api/overview.md && echo yes || echo no`);
      expect(out).toBe("yes");
    });
  }

  it("cloudflare-api overview has endpoint groups", () => {
    const out = ssh("rg 'endpoints' /docs/cloudflare-api/api/overview.md | head -3");
    expect(out).toContain("endpoints");
  });

  it("API schemas contain resolved types (not all any)", () => {
    // rg regex OR: string|integer|boolean
    const cfTypes = ssh(
      "rg -c 'string|integer|boolean' /docs/cloudflare-api/api/zone.md 2>/dev/null || echo 0",
    );
    const k8sTypes = ssh(
      "rg -c 'string|integer|boolean' /docs/kubernetes-api/api/overview.md 2>/dev/null || echo 0",
    );
    const total = parseInt(cfTypes) + parseInt(k8sTypes);
    expect(total, "No resolved types in API specs").toBeGreaterThan(0);
  });
});

// ─── Content tools ──────────────────────────────────────────────────

describe("content tools", () => {
  it("cat reads files", () => {
    const out = ssh("cat /docs/supabase/guides/auth.md | head -3");
    expect(out).toContain("Auth");
  });

  it("bat with --decorations=always shows line numbers over SSH pipe", () => {
    const out = ssh(
      "bat --decorations=always --paging=never --color=never --style=numbers /docs/supabase/guides/auth.md | head -3",
    );
    expect(out).toMatch(/^\s*\d+/); // line number prefix
  });

  it("bat --line-range reads specific lines", () => {
    const out = ssh(
      "bat --plain --paging=never --color=never --line-range=1:3 /docs/supabase/guides/auth.md",
    );
    const lines = out.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("rg --json returns structured output", () => {
    const out = ssh('rg --json "Auth" /docs/supabase/guides/auth.md | head -5');
    expect(out).toContain('"type"');
  });

  it("rg -n shows line numbers", () => {
    const out = ssh('rg -n "^#" /docs/supabase/guides/auth.md | head -3');
    expect(out).toMatch(/^\d+:/);
  });

  it("tree shows directory structure", () => {
    const out = ssh("tree /docs/supabase/ -L 1");
    expect(out).toContain("directories");
  });

  it("find locates files by pattern", () => {
    const out = ssh("find /docs/supabase -name '*auth*' -type f | head -5");
    expect(out).toContain("auth");
  });
});

// ─── Built-in commands ──────────────────────────────────────────────

describe("builtins", () => {
  it("help returns usage info", () => {
    const out = ssh("help");
    expect(out).toContain("docs");
  });

  it("sources lists all doc sets", () => {
    const out = ssh("sources");
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
  });

  it("agents (default) outputs SSH instructions", () => {
    const out = ssh("agents");
    expect(out).toContain("Documentation");
    expect(out).toContain("rg");
  });

  it("agents pi references docs_* extension tools", () => {
    const out = ssh("agents pi");
    expect(out).toContain("docs_search");
    expect(out).toContain("docs_read");
    expect(out).toContain("docs_grep");
    expect(out).toContain("docs_find");
    expect(out).toContain("docs_summary");
    expect(out).toContain("docs_sources");
    expect(out).not.toContain("ssh -p");
  });

  it("agents pi includes related source groups", () => {
    const out = ssh("agents pi");
    expect(out).toContain("Related source groups");
    expect(out).toContain("Auth & identity");
    expect(out).toContain("Databases");
  });

  it("agents opencode references custom tools", () => {
    const out = ssh("agents opencode");
    expect(out).toContain("docs_search");
    expect(out).toContain("docs_read");
    expect(out).toContain("Always use custom");
  });

  it("agents opencode includes related source groups", () => {
    const out = ssh("agents opencode");
    expect(out).toContain("Related source groups");
    expect(out).toContain("Auth & identity");
    expect(out).toContain("Databases");
    expect(out).toContain("Infrastructure");
  });

  it("agents (default) includes related source groups", () => {
    const out = ssh("agents");
    expect(out).toContain("Related source groups");
    expect(out).toContain("Reverse proxy");
    expect(out).toContain("Frontend frameworks");
  });

  it("agents claude outputs CLAUDE.md format", () => {
    const out = ssh("agents claude");
    expect(out).toContain("# CLAUDE.md");
  });

  it("agents cursor outputs instructions", () => {
    const out = ssh("agents cursor");
    expect(out).toContain("Documentation");
  });

  it("agents skill outputs YAML frontmatter", () => {
    const out = ssh("agents skill");
    expect(out).toContain("---");
    expect(out).toContain("name: docs-ssh");
  });

  it("tools outputs valid TypeScript", () => {
    const out = ssh("tools");
    expect(out).toContain('import { z } from "zod"');
    expect(out).toContain("export const search");
    expect(out).toContain("export const read");
    expect(out).toContain("export const grep");
    expect(out).toContain("export const summary");
    expect(out).toContain("export const sources");
  });

  it("tools pi outputs valid TypeScript Pi extension (TypeBox)", () => {
    const out = ssh("tools pi");
    expect(out).toContain("@earendil-works/pi-coding-agent");
    expect(out).toContain("defineTool");
    expect(out).toContain("docs_search");
    expect(out).toContain("docs_read");
    expect(out).toContain("SSH_HOST");
    expect(out).toContain("SSH_PORT");
  });
});

// ─── Caching ────────────────────────────────────────────────────────

describe("command caching", () => {
  it("repeated command succeeds (cache hit)", () => {
    const query = "rg -i 'smoke-test-cache-probe' /docs/_index.tsv || true";
    ssh(query);
    ssh(query); // cache hit
    expect(true).toBe(true);
  });
});

// ─── Security ───────────────────────────────────────────────────────

describe("security", () => {
  it("no .stamp.json files in image", () => {
    const count = ssh("find /docs -name '.stamp.json' | wc -l");
    expect(parseInt(count)).toBe(0);
  });

  it("no ANSI escape sequences in doc content (sample check)", () => {
    const ansiCount = ssh(
      "rg -c '\\x1b\\[' /docs/supabase/guides/auth.md 2>/dev/null || echo 0",
    );
    expect(parseInt(ansiCount)).toBe(0);
  });
});

// ─── Content negotiation (markdown via Accept: text/markdown) ─────
//
// Verifies HTML-scraping sources whose upstreams honour
// `Accept: text/markdown` (see acceptmarkdown.com spec / Cloudflare
// Markdown for Agents) ended up on disk as clean .md files with no
// HTML tag leakage. Designed to pass on both pre- and post-feature
// container builds:
//   - On post-feature builds: assertions verify negotiated markdown
//     reached disk intact (frontmatter, no <script>, no raw HTML).
//   - On pre-feature builds: same sources existed as Turndown output,
//     which also has no <script> tags and uses markdown link syntax.
//     Frontmatter-specific tests skip when no frontmatter is detected.

describe("negotiated-markdown content shape", () => {
  /**
   * Returns the first existing markdown file under a source dir, or
   * null when the source has no .md files (or doesn't exist).
   */
  function firstMdFile(sourcePath: string): string | null {
    try {
      const out = ssh(
        `find ${sourcePath} -name '*.md' -size +500c -size -50k 2>/dev/null | head -1`,
      );
      return out || null;
    } catch {
      return null;
    }
  }

  function sourceExists(name: string): boolean {
    return docSources.some((s) => s.name === name && s.count > 0);
  }

  it("HTML-scraping markdown-capable sources have zero .html files on disk", () => {
    // Whether the markdown came via content negotiation (new) or
    // Turndown rename (existing), the final extension must always be
    // `.md`. Catches the path-rewrite regression where pre-normalised
    // files were stuck as .html.
    const candidates = [
      "cloudflare-blog",
      "cloudflare-changelog",
      "ansible",
      "patroni",
      "prisma",
      "resend",
      "turborepo",
      "vercel-blog",
    ];
    for (const name of candidates) {
      if (!sourceExists(name)) continue;
      const htmlCount = parseInt(
        ssh(`find /docs/${name} -name '*.html' 2>/dev/null | wc -l || echo 0`),
      );
      expect(htmlCount, `${name} must contain no .html files`).toBe(0);
    }
  });

  it("no <script>/<style>/<nav>/<footer> tags leaked into markdown bodies", () => {
    // Structural sanity check that works on both Turndown output and
    // content-negotiated markdown. HtmlNormaliser strips these tags
    // before Turndown runs; Cloudflare's Markdown for Agents strips
    // them in its pre-processor.
    const candidates = ["cloudflare-blog", "cloudflare-changelog", "ansible", "prisma"];
    for (const name of candidates) {
      if (!sourceExists(name)) continue;
      const sample = firstMdFile(`/docs/${name}`);
      if (!sample) continue;
      const body = ssh(`head -50 ${sample}`);
      expect(body, `${sample} should not contain raw <script> tags`).not.toMatch(/<script\b/i);
      expect(body, `${sample} should not contain raw <style> tags`).not.toMatch(/<style\b/i);
      expect(body, `${sample} should not contain raw <nav> tags`).not.toMatch(/<nav\b/i);
      expect(body, `${sample} should not contain raw <footer> tags`).not.toMatch(/<footer\b/i);
    }
  });

  it("markdown bodies use markdown link syntax, not HTML <a> tags", () => {
    // [text](url), not <a href="…">text</a>. Both Turndown and
    // Cloudflare's converter produce the markdown form.
    const candidates = ["ansible", "prisma", "cloudflare-changelog"];
    for (const name of candidates) {
      if (!sourceExists(name)) continue;
      const sample = firstMdFile(`/docs/${name}`);
      if (!sample) continue;
      const body = ssh(`head -50 ${sample}`);
      // We allow `<a>` inside fenced code blocks (rare), so look for
      // unfenced occurrences only. Quick heuristic: any standalone
      // <a href=…> outside the first code fence range.
      const beforeFence = body.split("```")[0];
      expect(beforeFence, `${sample} should not contain unfenced <a href>`).not.toMatch(
        /<a\s+href=/i,
      );
    }
  });

  it("cloudflare-changelog: emits frontmatter when content-negotiation is active", () => {
    // Cloudflare's Markdown for Agents synthesises YAML frontmatter
    // (title/description/image) from <meta> tags. Old Turndown output
    // does NOT have frontmatter. Test passes either way: explicit
    // skip when frontmatter is absent (= pre-feature deployment).
    if (!sourceExists("cloudflare-changelog")) return;
    const sample = firstMdFile("/docs/cloudflare-changelog");
    if (!sample) return;
    const head = ssh(`head -1 ${sample}`);
    if (!head.startsWith("---")) {
      // Pre-feature deployment — Turndown output, no frontmatter.
      return;
    }
    // Post-feature deployment — verify frontmatter is well-formed.
    const block = ssh(`head -8 ${sample}`);
    expect(block).toMatch(/^---\s*$/m);
    expect(block).toMatch(/^title:/m);
  });
});
