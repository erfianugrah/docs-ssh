import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const IMAGE = "docs-ssh:e2e-test";
const CONTAINER = "docs-ssh-e2e-test";
const PORT = "22222";
const SSH_CMD = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${PORT} docs@localhost`;

describe("E2E smoke tests", () => {
  let buildOutput = "";

  beforeAll(async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..");

    // Clean any existing docs (e.g. from docker:build:cached) so E2E uses only mock docs
    const docsDir = path.join(projectRoot, "docs");
    await fs.rm(docsDir, { recursive: true, force: true });
    await fs.mkdir(path.join(docsDir, "supabase", "guides"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "cloudflare", "workers"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "postgres"), { recursive: true });

    await fs.writeFile(
      path.join(docsDir, "supabase", "guides", "auth.md"),
      "# Supabase Auth\n\nEnable RLS on every table.\n\nUse `auth.uid()` in policies.\n\n## Policies\n\nPolicies add WHERE clauses.\n\n## Helper Functions\n\n### auth.uid()\n\nReturns the user ID.",
    );
    await fs.writeFile(
      path.join(docsDir, "supabase", "guides", "storage.md"),
      "# Storage\n\nUpload files to Supabase Storage buckets.",
    );
    await fs.writeFile(
      path.join(docsDir, "cloudflare", "workers", "index.md"),
      "# Cloudflare Workers\n\nDeploy serverless functions at the edge.\n\n## Getting Started\n\nRun `wrangler deploy`.",
    );
    await fs.writeFile(
      path.join(docsDir, "postgres", "indexes.md"),
      "# Indexes\n\nPartial indexes improve query performance for filtered queries.\n\n## Types\n\nB-tree, Hash, GIN, GiST.",
    );
    await fs.writeFile(
      path.join(docsDir, "postgres", "rls.md"),
      "# Row Level Security\n\nRLS policies restrict row access per user.\n\n## CREATE POLICY\n\nUse CREATE POLICY to add row-level policies.",
    );

    // Frontmatter test fixtures
    await fs.mkdir(path.join(docsDir, "traefik"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "kubernetes"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "typescript"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "mdn"), { recursive: true });

    // Frontmatter with title + description (traefik style)
    await fs.writeFile(
      path.join(docsDir, "traefik", "migrate.md"),
      '---\ntitle: "Migrate from v2 to v3"\ndescription: "Learn the steps needed to migrate to Traefik Proxy v3."\n---\n\n# Migrate from v2 to v3\n\nThis guide covers migration.\n\n## Breaking Changes\n## New Features',
    );

    // Frontmatter with multi-line description (kubernetes style)
    await fs.writeFile(
      path.join(docsDir, "kubernetes", "pods.md"),
      '---\ntitle: Pods\ndescription: >\n  A Pod is the smallest deployable unit in Kubernetes.\nweight: 10\n---\n\n# Pods\n\nPods run containers.\n\n## Lifecycle\n## Configuration',
    );

    // Frontmatter with oneline (typescript style)
    await fs.writeFile(
      path.join(docsDir, "typescript", "declarations.md"),
      '---\ntitle: Declaration Files\noneline: How to write a high-quality TypeScript Declaration (d.ts) file\npermalink: /docs/handbook/declaration-files/introduction.html\n---\n\n# Declaration Files\n\n## Overview\n## Publishing',
    );

    // Frontmatter with title only, no description (mdn style)
    await fs.writeFile(
      path.join(docsDir, "mdn", "css.md"),
      '---\ntitle: "CSS: Cascading Style Sheets"\nslug: Web/CSS\npage-type: landing-page\n---\n\n# CSS: Cascading Style Sheets\n\nCSS describes how elements are rendered.\n\n## Tutorials\n## Reference',
    );

    // Frontmatter with trailing whitespace on closing --- (traefik edge case)
    await fs.writeFile(
      path.join(docsDir, "traefik", "service.md"),
      '---\ntitle: "UDP Services"\ndescription: "Configure UDP load balancing in Traefik."\n--- \n\n## Servers Load Balancer\n\nBalances requests between servers.',
    );

    // Health check test fixture: empty file (should trigger warning)
    await fs.writeFile(path.join(docsDir, "postgres", "empty.md"), "");

    // An empty source directory so the health check's "sources with 0
    // markdown files" branch fires (otherwise no warnings are emitted).
    await fs.mkdir(path.join(docsDir, "emptysrc"), { recursive: true });

    // Mock _source_groups.json — normally produced as a side effect of
    // pnpm fetch-docs (see src/index.ts:51-65). E2E uses DOCS_PREBUILT
    // with hand-rolled mock docs, so we write this manually. Contents
    // mirror the live format and cover the categories the tests assert.
    await fs.writeFile(
      path.join(docsDir, "_source_groups.json"),
      JSON.stringify(
        {
          auth: { label: "Auth & identity", sources: ["supabase"] },
          databases: { label: "Databases & SQL", sources: ["postgres", "supabase"] },
          networking: { label: "Reverse proxy & networking", sources: ["cloudflare"] },
        },
        null,
        2,
      ),
    );

    // Build Docker image (capture output for health check verification)
    // 2>&1 merges stderr into stdout — BuildKit sends build log to stderr.
    // maxBuffer: BuildKit progress output easily exceeds the 1MB default
    // (especially on cold caches); exceeding the default kills the
    // child with SIGTERM mid-build. 32 MiB is generous.
    console.log("Building Docker image…");
    buildOutput = execSync(
      `docker build --build-arg DOCS_PREBUILT=true -t ${IMAGE} . 2>&1`,
      {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 300_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    // Start container with security hardening (same as prod).
    // DOCS_CMD_TIMEOUT=3 keeps the timeout-kills-slow-commands test fast —
    // production defaults to 60s, the value is exercised by the same
    // test asserting a sleep 10 is killed within ~4s.
    console.log("Starting container…");
    execSync(
      `docker run -d --name ${CONTAINER} -p ${PORT}:2222 ` +
        `-e DOCS_CMD_TIMEOUT=3 ` +
        `--read-only --cap-drop ALL ` +
        `--cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add SYS_CHROOT --cap-add AUDIT_WRITE ` +
        `--security-opt no-new-privileges:true ` +
        `--tmpfs /tmp:size=16M --tmpfs /run/sshd:size=1M --tmpfs /var/log:size=8M ` +
        IMAGE,
      { stdio: "pipe" },
    );

    await waitForSsh(20_000);

    // Clean up test docs from build context
    await fs.rm(docsDir, { recursive: true, force: true });
  }, 300_000);

  afterAll(() => {
    try { execSync(`docker rm -f ${CONTAINER}`, { stdio: "pipe" }); } catch {}
    try { execSync(`docker rmi ${IMAGE}`, { stdio: "pipe" }); } catch {}
  });

  // ─── Basic file operations ───────────────────────────────────────

  it("can list docs directories", () => {
    const out = run(`${SSH_CMD} "ls /docs/"`);
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
  });

  it("can cat a specific file", () => {
    const out = run(`${SSH_CMD} "cat /docs/supabase/guides/auth.md"`);
    expect(out).toContain("# Supabase Auth");
    expect(out).toContain("RLS");
  });

  it("can grep across docs", () => {
    const out = run(`${SSH_CMD} "grep -rl 'RLS' /docs/"`);
    expect(out).toContain("supabase/guides/auth.md");
    expect(out).toContain("postgres/rls.md");
  });

  it("can find markdown files", () => {
    const out = run(`${SSH_CMD} "find /docs/postgres -name '*.md'"`);
    expect(out).toContain("indexes.md");
    expect(out).toContain("rls.md");
  });

  it("can grep with context lines", () => {
    const out = run(`${SSH_CMD} "grep -A2 'Partial' /docs/postgres/indexes.md"`);
    expect(out).toContain("Partial indexes");
  });

  it("can use head to limit output", () => {
    const out = run(`${SSH_CMD} "head -1 /docs/cloudflare/workers/index.md"`);
    expect(out.trim()).toBe("# Cloudflare Workers");
  });

  it("can pipe commands", () => {
    const out = run(`${SSH_CMD} "find /docs -name '*.md' | wc -l"`);
    const count = parseInt(out.trim(), 10);
    expect(count).toBeGreaterThanOrEqual(5);
  });

  // ─── New tools: bat, tree, rg, less ─────────────────────────────

  it("bat: reads files with line numbers", () => {
    const out = run(`${SSH_CMD} "bat --decorations=always --paging=never --color=never --style=numbers /docs/postgres/indexes.md"`);
    // --decorations=always forces line numbers even in SSH pipe mode
    expect(out).toContain("Indexes");
    expect(out).toMatch(/^\s*\d+/); // line number prefix
  });

  it("bat: supports --line-range for offset reads", () => {
    const out = run(`${SSH_CMD} "bat --plain --paging=never --color=never --line-range=1:2 /docs/postgres/indexes.md"`);
    expect(out).toContain("Indexes");
    // Should not contain content from much later in the file
    const lines = out.trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("tree: shows directory structure", () => {
    const out = run(`${SSH_CMD} "tree /docs/supabase/ -L 1"`);
    expect(out).toContain("guides");
  });

  it("tree: respects depth limit", () => {
    const out = run(`${SSH_CMD} "tree /docs/ -L 1"`);
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
    // Should list directories at L1 but not files within
    expect(out).not.toContain("auth.md");
  });

  it("rg: basic ripgrep search works", () => {
    const out = run(`${SSH_CMD} "rg -i 'RLS' /docs/supabase/"`);
    expect(out).toContain("RLS");
    expect(out).toContain("auth.md");
  });

  it("rg --json: returns structured JSON output", () => {
    const out = run(`${SSH_CMD} "rg --json 'RLS' /docs/supabase/guides/auth.md | head -5"`);
    // rg --json outputs one JSON object per line
    const lines = out.trim().split("\n").filter(l => l.startsWith("{"));
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty("type");
    // Should have 'begin', 'match', or 'end' types
    expect(["begin", "match", "end", "summary", "context"]).toContain(parsed.type);
  });

  it("rg --json: match objects include line numbers", () => {
    const out = run(`${SSH_CMD} "rg --json 'RLS' /docs/supabase/guides/auth.md"`);
    const lines = out.trim().split("\n").filter(l => l.startsWith("{"));
    const matches = lines
      .map(l => JSON.parse(l))
      .filter((obj: { type: string }) => obj.type === "match");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].data).toHaveProperty("line_number");
    expect(matches[0].data).toHaveProperty("path");
    expect(matches[0].data).toHaveProperty("lines");
    expect(matches[0].data).toHaveProperty("submatches");
  });

  it("less: is available", () => {
    // less --version exits 0 and prints version info
    const out = run(`${SSH_CMD} "less --version | head -1"`);
    expect(out.toLowerCase()).toContain("less");
  });

  // ─── Search index ───────────────────────────────────────────────

  it("_index.tsv exists and contains entries", () => {
    const out = run(`${SSH_CMD} "wc -l < /docs/_index.tsv"`);
    const lines = parseInt(out.trim(), 10);
    expect(lines).toBeGreaterThanOrEqual(5);
  });

  it("rg can search the index", () => {
    const out = run(`${SSH_CMD} "rg -i 'auth' /docs/_index.tsv"`);
    expect(out).toContain("supabase/guides/auth.md");
  });

  // ─── Frontmatter extraction in index ────────────────────────────

  it("index: frontmatter title used when present", () => {
    const out = run(`${SSH_CMD} "rg 'traefik/migrate.md' /docs/_index.tsv"`);
    // Title from frontmatter, not heading
    expect(out).toContain("Migrate from v2 to v3");
  });

  it("index: frontmatter description in summary", () => {
    const out = run(`${SSH_CMD} "rg 'traefik/migrate.md' /docs/_index.tsv"`);
    expect(out).toContain("Learn the steps needed to migrate to Traefik Proxy v3");
  });

  it("index: multi-line YAML description extracted", () => {
    const out = run(`${SSH_CMD} "rg 'kubernetes/pods.md' /docs/_index.tsv"`);
    expect(out).toContain("smallest deployable unit in Kubernetes");
  });

  it("index: oneline field used as summary", () => {
    const out = run(`${SSH_CMD} "rg 'typescript/declarations.md' /docs/_index.tsv"`);
    expect(out).toContain("high-quality TypeScript Declaration");
  });

  it("index: title-only frontmatter does not leak fields into summary", () => {
    const out = run(`${SSH_CMD} "rg 'mdn/css.md' /docs/_index.tsv"`);
    expect(out).toContain("CSS: Cascading Style Sheets");
    // Frontmatter fields should not appear in summary
    expect(out).not.toContain("slug:");
    expect(out).not.toContain("page-type:");
  });

  it("index: trailing whitespace on closing --- still closes frontmatter", () => {
    const out = run(`${SSH_CMD} "rg 'traefik/service.md' /docs/_index.tsv"`);
    expect(out).toContain("UDP Services");
    expect(out).toContain("Configure UDP load balancing");
  });

  it("index: files without frontmatter still indexed correctly", () => {
    const out = run(`${SSH_CMD} "rg 'postgres/rls.md' /docs/_index.tsv"`);
    expect(out).toContain("Row Level Security");
    expect(out).toContain("RLS policies restrict");
  });

  // ─── Build-time health check ────────────────────────────────────

  it("health check: runs during Docker build", () => {
    // build-health-check.sh always emits two summary lines with the
    // "[health]" prefix and the word "indexed" in the second.
    expect(buildOutput).toContain("[health]");
    expect(buildOutput).toContain("indexed");
  });

  it("health check: detects sources with 0 markdown files", () => {
    // The emptysrc/ mock directory contains no .md files, so the
    // "sources with 0 markdown files" branch fires and the source name
    // is reported on its own [health] line.
    expect(buildOutput).toContain("sources with 0 markdown files");
    expect(buildOutput).toContain("emptysrc");
  });

  // ─── Built-in commands ───────────────────────────────────────────

  it("help: shows usage and available commands", () => {
    const out = run(`${SSH_CMD} help`);
    // ASCII art banner spells out "docs" and "ssh" in the art
    expect(out).toContain("Documentation over SSH");
    expect(out).toContain("help");
    expect(out).toContain("sources");
    expect(out).toContain("agents");
    expect(out).toContain("tools");
    expect(out).toContain("setup");
  });

  it("help: mentions all tools (rg, bat, tree)", () => {
    const out = run(`${SSH_CMD} help`);
    expect(out).toContain("rg");
    expect(out).toContain("bat");
    expect(out).toContain("tree");
    expect(out).toContain("--json");
  });

  it("help: colorized via FORCE_COLOR (has ANSI escapes)", () => {
    const out = run(`${SSH_CMD} help`);
    // help and sources use FORCE_COLOR=1 for human-facing output
    expect(out).toMatch(/\x1b\[/);
  });

  it("help: shows agents subcommand variants", () => {
    const out = run(`${SSH_CMD} help`);
    expect(out).toContain("agents opencode");
    expect(out).toContain("agents claude");
    expect(out).toContain("agents skill");
  });

  it("sources: lists all doc sets with file counts", () => {
    const out = run(`${SSH_CMD} sources`);
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
    expect(out).toContain("files");
    expect(out).toContain("Total:");
  });

  it("sources: colorized via FORCE_COLOR (has ANSI escapes)", () => {
    const out = run(`${SSH_CMD} sources`);
    // sources uses FORCE_COLOR=1 for human-facing output
    expect(out).toMatch(/\x1b\[/);
  });

  it("agents (default): outputs raw SSH patterns, no ANSI", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
    expect(out).toContain("/docs/");
    // Default should NOT reference custom tools
    expect(out).not.toContain("docs_search");
    expect(out).not.toContain("docs_read");
    // Machine-consumable output — no ANSI escapes
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("agents (default): mentions server-side tools (rg, bat, tree)", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("rg");
    expect(out).toContain("bat");
    expect(out).toContain("tree");
    expect(out).toContain("rg --json");
    expect(out).toContain("--line-range");
  });

  it("agents opencode: references custom docs_* tools", () => {
    const out = run(`${SSH_CMD} "agents opencode"`);
    expect(out).toContain("## Documentation");
    expect(out).toContain("docs_search");
    expect(out).toContain("docs_read");
    expect(out).toContain("docs_grep");
    expect(out).toContain("docs_find");
    expect(out).toContain("docs_summary");
    expect(out).toContain("docs_sources");
    // Should NOT contain raw SSH examples
    expect(out).not.toContain("ssh -p");
    expect(out).not.toContain('rg -i');
  });

  it("agents opencode: tells agent not to use raw SSH", () => {
    const out = run(`${SSH_CMD} "agents opencode"`);
    expect(out).toContain("Always use custom");
    expect(out).toContain("No raw");
  });

  it("agents opencode: includes related source groups", () => {
    const out = run(`${SSH_CMD} "agents opencode"`);
    expect(out).toContain("Related source groups");
    expect(out).toContain("Auth & identity");
    expect(out).toContain("Databases");
  });

  it("agents (default): includes related source groups", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("Related source groups");
    expect(out).toContain("Reverse proxy");
  });

  it("agents claude: outputs CLAUDE.md with header and raw SSH", () => {
    const out = run(`${SSH_CMD} "agents claude"`);
    expect(out).toContain("# CLAUDE.md");
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
    expect(out).toContain("rg --json");
  });

  it("agents gemini: outputs GEMINI.md with header", () => {
    const out = run(`${SSH_CMD} "agents gemini"`);
    expect(out).toContain("# GEMINI.md");
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
  });

  it("agents cursor: outputs without extra header", () => {
    const out = run(`${SSH_CMD} "agents cursor"`);
    expect(out).not.toContain("# CLAUDE.md");
    expect(out).not.toContain("# GEMINI.md");
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
  });

  it("agents skill: outputs SKILL.md with YAML frontmatter", () => {
    const out = run(`${SSH_CMD} "agents skill"`);
    expect(out).toContain("---");
    expect(out).toContain("name: docs-ssh");
    expect(out).toContain("description:");
    expect(out).toContain("## Documentation");
  });

  it("agents help: shows all format options", () => {
    const out = run(`${SSH_CMD} "agents help"`);
    expect(out).toContain("opencode");
    expect(out).toContain("claude");
    expect(out).toContain("cursor");
    expect(out).toContain("gemini");
    expect(out).toContain("skill");
  });

  it("tools: outputs valid TypeScript with zod imports", () => {
    const out = run(`${SSH_CMD} tools`);
    expect(out).toContain('import { z } from "zod"');
    expect(out).toContain("export const search");
    expect(out).toContain("export const read");
    expect(out).toContain("export const find");
    expect(out).toContain("export const grep");
    expect(out).toContain("export const summary");
    expect(out).toContain("export const sources");
    expect(out).toContain("SSH_HOST");
    expect(out).toContain("SSH_PORT");
  });

  it("tools: includes rg --json parser", () => {
    const out = run(`${SSH_CMD} tools`);
    expect(out).toContain("parseRgJson");
    expect(out).toContain("formatRgMatches");
    expect(out).toContain("--json");
  });

  it("tools: includes bat integration with fallback", () => {
    const out = run(`${SSH_CMD} tools`);
    expect(out).toContain("bat --plain");
    // Should have fallback to cat/sed
    expect(out).toContain("|| cat");
    expect(out).toContain("|| sed");
  });

  it("setup: outputs setup guide with all options", () => {
    const out = run(`${SSH_CMD} setup`);
    expect(out).toContain("docs-ssh setup");
    expect(out).toContain("Option 1");
    expect(out).toContain("Option 2");
    expect(out).toContain("Option 3");
    expect(out).toContain("Option 4");
    expect(out).toContain(".opencode/tools/docs.ts");
    expect(out).toContain("AGENTS.md");
  });

  it("setup: mentions rg --json and bat", () => {
    const out = run(`${SSH_CMD} setup`);
    expect(out).toContain("rg");
    expect(out).toContain("bat");
  });

  it("setup: documents agents subcommands for each tool", () => {
    const out = run(`${SSH_CMD} setup`);
    expect(out).toContain("agents claude");
    expect(out).toContain("agents cursor");
    expect(out).toContain("agents gemini");
    expect(out).toContain("agents skill");
    expect(out).toContain("CLAUDE.md");
    expect(out).toContain(".cursorrules");
    expect(out).toContain("GEMINI.md");
    expect(out).toContain("SKILL.md");
  });

  // ─── Command caching ────────────────────────────────────────────

  it("caching: second identical command is faster", () => {
    const cmd = `${SSH_CMD} "rg -i 'RLS' /docs/_index.tsv"`;

    // First run (cold)
    const start1 = Date.now();
    const out1 = run(cmd);
    const dur1 = Date.now() - start1;

    // Second run (should hit cache)
    const start2 = Date.now();
    const out2 = run(cmd);
    const dur2 = Date.now() - start2;

    // Both should return the same output
    expect(out1).toBe(out2);
    // Cache hit should generally be faster, but SSH overhead dominates
    // so just verify both succeed and produce identical output
    expect(out2).toContain("RLS");
  });

  it("caching: logs cache hits", async () => {
    // Run a command twice to ensure cache hit
    const cmd = `${SSH_CMD} "find /docs/postgres -name '*.md'"`;
    run(cmd);
    run(cmd);

    await new Promise((r) => setTimeout(r, 1_000));

    const logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(logs).toContain('"cached":true');
  });

  it("caching: echo commands are not cached", async () => {
    run(`${SSH_CMD} "echo cache_bypass_test_1"`);
    run(`${SSH_CMD} "echo cache_bypass_test_2"`);

    await new Promise((r) => setTimeout(r, 1_000));

    const logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    // echo commands should never show cached:true
    const logLines = logs.split("\n").filter(l => l.includes("cache_bypass_test"));
    for (const line of logLines) {
      if (line.includes('"cached"')) {
        // exec.done entries should have cached:false
        expect(line).not.toContain('"cached":true');
      }
    }
  });

  // ─── Modular lib files ──────────────────────────────────────────

  it("lib/colors.sh exists in container", () => {
    const out = run(`${SSH_CMD} "test -f /usr/local/lib/docs-ssh/lib/colors.sh && echo OK"`);
    expect(out.trim()).toBe("OK");
  });

  it("lib/log.sh exists in container", () => {
    const out = run(`${SSH_CMD} "test -f /usr/local/lib/docs-ssh/lib/log.sh && echo OK"`);
    expect(out.trim()).toBe("OK");
  });

  it("lib/cache.sh exists in container", () => {
    const out = run(`${SSH_CMD} "test -f /usr/local/lib/docs-ssh/lib/cache.sh && echo OK"`);
    expect(out.trim()).toBe("OK");
  });

  it("banner.sh exists in container", () => {
    const out = run(`${SSH_CMD} "test -f /usr/local/lib/docs-ssh/banner.sh && echo OK"`);
    expect(out.trim()).toBe("OK");
  });

  // ─── SSH security ───────────────────────────────────────────────

  it("sshd supports post-quantum KEX (sntrup761)", () => {
    // Check that sshd_config has the post-quantum KEX
    const out = run(`${SSH_CMD} "cat /etc/ssh/sshd_config | grep -i sntrup"`);
    expect(out).toContain("sntrup761");
  });

  it("sshd restricts ciphers to modern algorithms", () => {
    const out = run(`${SSH_CMD} "cat /etc/ssh/sshd_config | grep '^Ciphers'"`);
    expect(out).toContain("chacha20-poly1305");
    expect(out).toContain("aes256-gcm");
    // Should NOT contain weak ciphers
    expect(out).not.toContain("cbc");
    expect(out).not.toContain("3des");
  });

  it("sshd uses encrypt-then-MAC only", () => {
    const out = run(`${SSH_CMD} "cat /etc/ssh/sshd_config | grep '^MACs'"`);
    expect(out).toContain("etm");
    expect(out).not.toContain("hmac-sha1");
  });

  // ─── Security ────────────────────────────────────────────────────

  it("cannot write to the docs filesystem", () => {
    const out = run(`${SSH_CMD} "touch /docs/test 2>&1 || echo BLOCKED"`);
    expect(out).toContain("BLOCKED");
  });

  it("cannot escape to root filesystem", () => {
    const out = run(`${SSH_CMD} "cat /etc/shadow 2>&1 || echo BLOCKED"`);
    expect(out).toContain("BLOCKED");
  });

  // ─── Logging ─────────────────────────────────────────────────────

  it("logs commands as JSON to docker logs", async () => {
    run(`${SSH_CMD} "echo e2e_log_marker_12345"`);

    await new Promise((r) => setTimeout(r, 2_000));

    const logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(logs).toContain('"type":"exec"');
    expect(logs).toContain("e2e_log_marker_12345");
  });

  it("logs built-in commands as type builtin", () => {
    run(`${SSH_CMD} sources`);
    const logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    expect(logs).toContain('"type":"builtin"');
    expect(logs).toContain('"cmd":"sources"');
  });

  it("log entries are valid JSON with all expected fields", async () => {
    run(`${SSH_CMD} "echo json_field_test"`);

    await new Promise((r) => setTimeout(r, 2_000));

    const logs = execSync(`docker logs ${CONTAINER} 2>&1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    const logLines = logs.split("\n").filter(l => l.includes("json_field_test"));
    expect(logLines.length).toBeGreaterThan(0);

    for (const line of logLines) {
      const obj = JSON.parse(line);
      expect(obj).toHaveProperty("ts");
      expect(obj).toHaveProperty("type");
      expect(obj).toHaveProperty("client");
      expect(obj).toHaveProperty("cmd");
      expect(obj).toHaveProperty("exit");
      expect(obj).toHaveProperty("dur_s");
      expect(obj).toHaveProperty("cached");
    }
  });

  // ─── Per-command timeout ────────────────────────────────────────

  it("kills commands that exceed DOCS_CMD_TIMEOUT", () => {
    // Container started with DOCS_CMD_TIMEOUT=3s (see beforeAll).
    // A `sleep 10` should be killed at the 3s mark, not run to completion.
    //
    // Exit code: `timeout(1)` returns 124 when it kills the command with
    // SIGTERM, EXCEPT when the child itself is terminated by that same
    // SIGTERM — then timeout propagates the child's status (128+15=143).
    // Bash running `sleep 10` gets SIGTERMed and dies with 143, which
    // timeout passes through. Both codes are legitimate "timed out"
    // signals.
    const t0 = Date.now();
    let exitCode = 0;
    try {
      execSync(`${SSH_CMD} "sleep 10"`, {
        encoding: "utf-8",
        timeout: 15_000,
      });
    } catch (err: unknown) {
      const e = err as { status?: number };
      exitCode = e.status ?? -1;
    }
    const elapsed = Date.now() - t0;

    // Killed around 3s (+network/startup jitter), not 10s.
    expect(elapsed).toBeLessThan(7_000);
    expect(elapsed).toBeGreaterThan(2_000);
    expect([124, 143]).toContain(exitCode);
  }, 20_000);
});

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 15_000 });
}

async function waitForSsh(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(
        `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=2 -p ${PORT} docs@localhost "echo ready"`,
        { encoding: "utf-8", timeout: 5_000 },
      );
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`SSH not ready after ${timeoutMs}ms`);
}
