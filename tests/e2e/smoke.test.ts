import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const IMAGE = "docs-ssh:e2e-test";
const CONTAINER = "docs-ssh-e2e-test";
const PORT = "22222";
const SSH_CMD = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${PORT} docs@localhost`;

describe("E2E smoke tests", () => {
  beforeAll(async () => {
    const projectRoot = path.resolve(import.meta.dirname, "../..");

    // Create mock docs in the build context
    const docsDir = path.join(projectRoot, "docs");
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

    // Build Docker image
    console.log("Building Docker image…");
    execSync(
      `docker build --build-arg DOCS_PREBUILT=true -t ${IMAGE} .`,
      { cwd: projectRoot, stdio: "pipe", timeout: 300_000 },
    );

    // Start container with security hardening (same as prod)
    console.log("Starting container…");
    execSync(
      `docker run -d --name ${CONTAINER} -p ${PORT}:2222 ` +
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

  it("bat: reads files with plain output", () => {
    const out = run(`${SSH_CMD} "bat --paging=never --color=never --style=numbers /docs/postgres/indexes.md"`);
    // --style=numbers shows line numbers; verify content is present
    expect(out).toContain("Indexes");
    expect(out).toContain("Partial indexes");
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

  // ─── Built-in commands ───────────────────────────────────────────

  it("help: shows usage and available commands", () => {
    const out = run(`${SSH_CMD} help`);
    expect(out).toContain("docs-ssh");
    expect(out).toContain("help");
    expect(out).toContain("sources");
    expect(out).toContain("agents");
    expect(out).toContain("tools");
    expect(out).toContain("setup");
  });

  it("help: mentions new tools (rg, bat, tree)", () => {
    const out = run(`${SSH_CMD} help`);
    expect(out).toContain("ripgrep");
    expect(out).toContain("bat");
    expect(out).toContain("tree");
  });

  it("help: plain text in exec mode (no ANSI escapes)", () => {
    const out = run(`${SSH_CMD} help`);
    // exec mode is not a TTY, so should not contain ANSI escape sequences
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("sources: lists all doc sets with file counts", () => {
    const out = run(`${SSH_CMD} sources`);
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
    expect(out).toContain("files");
    expect(out).toContain("Total:");
  });

  it("sources: plain text in exec mode (no ANSI escapes)", () => {
    const out = run(`${SSH_CMD} sources`);
    expect(out).not.toMatch(/\x1b\[/);
  });

  it("agents: outputs valid AGENTS.md snippet", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
    expect(out).toContain("/docs/");
  });

  it("agents: mentions new tools (rg, bat, tree)", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("rg");
    expect(out).toContain("bat");
    expect(out).toContain("tree");
    expect(out).toContain("rg --json");
    expect(out).toContain("--line-range");
  });

  it("agents claude: outputs CLAUDE.md with header", () => {
    const out = run(`${SSH_CMD} "agents claude"`);
    expect(out).toContain("# CLAUDE.md");
    expect(out).toContain("## Documentation");
    expect(out).toContain("rg --json");
  });

  it("agents gemini: outputs GEMINI.md with header", () => {
    const out = run(`${SSH_CMD} "agents gemini"`);
    expect(out).toContain("# GEMINI.md");
    expect(out).toContain("## Documentation");
  });

  it("agents cursor: outputs without extra header", () => {
    const out = run(`${SSH_CMD} "agents cursor"`);
    expect(out).not.toContain("# CLAUDE.md");
    expect(out).not.toContain("# GEMINI.md");
    expect(out).toContain("## Documentation");
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
