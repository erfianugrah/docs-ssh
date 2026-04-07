import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

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
    // At least the 5 test files (may be more if real docs leaked into build context)
    expect(count).toBeGreaterThanOrEqual(5);
  });

  // ─── Built-in commands ───────────────────────────────────────────

  it("help: shows usage and available commands", () => {
    const out = run(`${SSH_CMD} help`);
    expect(out).toContain("docs-ssh");
    expect(out).toContain("Built-in commands:");
    expect(out).toContain("help");
    expect(out).toContain("sources");
    expect(out).toContain("agents");
    expect(out).toContain("tools");
    expect(out).toContain("setup");
  });

  it("sources: lists all doc sets with file counts", () => {
    const out = run(`${SSH_CMD} sources`);
    expect(out).toContain("supabase");
    expect(out).toContain("cloudflare");
    expect(out).toContain("postgres");
    expect(out).toContain("files");
    expect(out).toContain("Total:");
  });

  it("agents: outputs valid AGENTS.md snippet", () => {
    const out = run(`${SSH_CMD} agents`);
    expect(out).toContain("## Documentation");
    expect(out).toContain("ssh -p");
    expect(out).toContain("grep -rl");
    expect(out).toContain("/docs/");
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

  it("setup: outputs setup guide with all options", () => {
    const out = run(`${SSH_CMD} setup`);
    expect(out).toContain("docs-ssh setup");
    expect(out).toContain("Option 1");
    expect(out).toContain("Option 2");
    expect(out).toContain("Option 3");
    expect(out).toContain(".opencode/tools/docs.ts");
    expect(out).toContain("AGENTS.md");
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
    // Run a distinctive command
    run(`${SSH_CMD} "echo e2e_log_marker_12345"`);

    // Wait for log to flush
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
