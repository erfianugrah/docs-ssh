import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const IMAGE = "docs-ssh:e2e-test";
const CONTAINER = "docs-ssh-e2e-test";
const PORT = "22222"; // avoid clashing with anything
const SSH_CMD = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p ${PORT} docs@localhost`;

describe("E2E smoke tests", () => {
  let tmpDocsDir: string;

  beforeAll(async () => {
    // 1. Create a test docs tree
    tmpDocsDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-e2e-"));
    const projectRoot = path.resolve(import.meta.dirname, "../..");

    // Create mock docs in the build context
    const docsDir = path.join(projectRoot, "docs");
    await fs.mkdir(path.join(docsDir, "supabase", "guides"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "cloudflare", "workers"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "postgres"), { recursive: true });

    await fs.writeFile(
      path.join(docsDir, "supabase", "guides", "auth.md"),
      "# Supabase Auth\n\nEnable RLS on every table.\n\nUse `auth.uid()` in policies.",
    );
    await fs.writeFile(
      path.join(docsDir, "supabase", "guides", "storage.md"),
      "# Storage\n\nUpload files to Supabase Storage buckets.",
    );
    await fs.writeFile(
      path.join(docsDir, "cloudflare", "workers", "index.md"),
      "# Cloudflare Workers\n\nDeploy serverless functions at the edge.",
    );
    await fs.writeFile(
      path.join(docsDir, "postgres", "indexes.md"),
      "# Indexes\n\nPartial indexes improve query performance for filtered queries.",
    );
    await fs.writeFile(
      path.join(docsDir, "postgres", "rls.md"),
      "# Row Level Security\n\nRLS policies restrict row access per user.",
    );

    // 2. Build Docker image with the test docs pre-baked
    console.log("Building Docker image…");
    execSync(
      `docker build --build-arg DOCS_PREBUILT=true -t ${IMAGE} .`,
      { cwd: projectRoot, stdio: "pipe", timeout: 300_000 },
    );

    // 3. Start container
    console.log("Starting container…");
    execSync(
      `docker run -d --name ${CONTAINER} -p ${PORT}:2222 ${IMAGE}`,
      { stdio: "pipe" },
    );

    // 4. Wait for sshd to be ready
    await waitForSsh(15_000);

    // Clean up the test docs from the build context so they don't persist
    await fs.rm(docsDir, { recursive: true, force: true });
  }, 180_000);

  afterAll(() => {
    try {
      execSync(`docker rm -f ${CONTAINER}`, { stdio: "pipe" });
    } catch {
      // container may already be gone
    }
    try {
      execSync(`docker rmi ${IMAGE}`, { stdio: "pipe" });
    } catch {
      // image may already be gone
    }
  });

  it("can list docs directories with ls", () => {
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
    expect(count).toBe(5);
  });
});

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", timeout: 10_000 });
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
