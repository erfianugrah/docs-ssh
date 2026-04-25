import { describe, it, expect } from "vitest";
import { GitIngestor } from "../../../src/ingestors/GitIngestor.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

describe("GitIngestor", () => {
  const ingestor = new GitIngestor();
  // Fast-retry ingestor for tests that exercise the retry path without
  // waiting real exponential-backoff seconds.
  const fastIngestor = new GitIngestor({ retries: 2, base: 10, jitter: 0 });

  it("supports git sources", () => {
    const src = new DocSource({ name: "x", type: "git", format: "markdown", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(true);
  });

  it("does not support http sources", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(false);
  });

  it("returns a DocSet with correct source name", async () => {
    // Use a local bare git repo as the remote to avoid network calls
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-test-"));
    const repoDir = path.join(tmpDir, "repo");
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(repoDir);
    await fs.mkdir(workDir);

    // Init a minimal git repo with one markdown file
    execSync("git init --bare --initial-branch=main", { cwd: repoDir, stdio: "pipe" });

    const cloneDir = path.join(tmpDir, "clone");
    execSync(`git clone ${repoDir} ${cloneDir}`, { stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: cloneDir, stdio: "pipe" });
    await fs.mkdir(path.join(cloneDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(cloneDir, "docs", "index.md"), "# Hello");
    execSync("git add .", { cwd: cloneDir, stdio: "pipe" });
    execSync("git -c commit.gpgsign=false commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git push origin main", { cwd: cloneDir, stdio: "pipe" });

    const src = new DocSource({
      name: "test-repo",
      type: "git",
      format: "markdown",
      url: repoDir,
      paths: ["docs"],
      rootPath: "docs",
    });

    const set = await ingestor.ingest(src, workDir);

    expect(set.id).toBe("test-repo");
    expect(set.size).toBeGreaterThan(0);
    expect(set.hasFile("index.md")).toBe(true);
    expect(set.getFile("index.md")?.content).toContain("# Hello");

    await fs.rm(tmpDir, { recursive: true });
  }, 30_000);

  it("recovers from a leftover partial-clone dir on the clone path", async () => {
    // If a previous run's clone was killed partway (network drop,
    // timeout), the target dir may still exist with partial content.
    // A partial dir that looks 'present' should be cleaned before
    // clone retries so we don't hit "destination path already exists".
    //
    // Simulate: bare repo is valid and reachable, but the cloneDir
    // already contains junk from a pretend-partial previous attempt.
    // Clone should succeed by wiping the leftover.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-partial-"));
    const repoDir = path.join(tmpDir, "repo");
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(repoDir);
    await fs.mkdir(workDir);

    // Build a valid bare repo
    execSync("git init --bare --initial-branch=main", { cwd: repoDir, stdio: "pipe" });
    const seedDir = path.join(tmpDir, "seed");
    execSync(`git clone ${repoDir} ${seedDir}`, { stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: seedDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: seedDir, stdio: "pipe" });
    await fs.writeFile(path.join(seedDir, "README.md"), "# Valid");
    execSync("git add .", { cwd: seedDir, stdio: "pipe" });
    execSync("git -c commit.gpgsign=false commit -m 'init'", { cwd: seedDir, stdio: "pipe" });
    execSync("git push origin main", { cwd: seedDir, stdio: "pipe" });

    // Pre-pollute the clone target with junk that ISN'T a valid git
    // repo so the pull path would fail, AND has content that would
    // make git clone error with "destination path ... not empty".
    const cloneDir = path.join(workDir, "partial");
    await fs.mkdir(cloneDir);
    await fs.writeFile(path.join(cloneDir, "stray.txt"), "leftover");

    const src = new DocSource({
      name: "partial",
      type: "git",
      format: "markdown",
      url: repoDir,
    });

    // Current behaviour: exists(cloneDir) is true → pull branch runs.
    // pull fails (not a git repo). Source errors, no recovery.
    // After fix: detect non-repo dir and fall through to clone with
    // cleanup, or clean unconditionally on the clone path before
    // retrying. Either way, the source should succeed.
    const set = await fastIngestor.ingest(src, workDir);
    expect(set.size).toBeGreaterThan(0);
    expect(set.hasFile("README.md")).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  }, 30_000);

  it("retries transient clone failures with backoff", async () => {
    // A bogus URL — git will fail immediately on each attempt. We just
    // check that the attempt count reflects retry behaviour by measuring
    // elapsed time (2 retries * 10ms base = ~30ms total, vs ~0ms without).
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-retry-"));
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(workDir);

    const src = new DocSource({
      name: "bogus",
      type: "git",
      format: "markdown",
      url: "/nonexistent/path/to/repo.git",
    });

    const start = Date.now();
    await expect(fastIngestor.ingest(src, workDir)).rejects.toThrow();
    const elapsed = Date.now() - start;

    // With base=10ms and retries=2: delays are 10ms + 20ms = 30ms minimum.
    // Allow up to a few seconds for git process overhead (fork+exec x3).
    expect(elapsed).toBeGreaterThanOrEqual(25);

    await fs.rm(tmpDir, { recursive: true });
  }, 10_000);

  it("re-applies sparse-checkout when source.paths changes between runs", async () => {
    // On first ingest, sparse-checkout restricts to ["a"]. On a second
    // ingest with paths=["a","b"], the new path "b" must become visible.
    // Previously the sparse-checkout step only ran on initial clone;
    // subsequent runs kept the stored sparse config and newly requested
    // paths were silently ignored.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-sparse-"));
    const repoDir = path.join(tmpDir, "repo");
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(repoDir);
    await fs.mkdir(workDir);

    execSync("git init --bare --initial-branch=main", { cwd: repoDir, stdio: "pipe" });

    const cloneDir = path.join(tmpDir, "clone");
    execSync(`git clone ${repoDir} ${cloneDir}`, { stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: cloneDir, stdio: "pipe" });
    await fs.mkdir(path.join(cloneDir, "a"), { recursive: true });
    await fs.mkdir(path.join(cloneDir, "b"), { recursive: true });
    await fs.writeFile(path.join(cloneDir, "a", "index.md"), "# A");
    await fs.writeFile(path.join(cloneDir, "b", "index.md"), "# B");
    execSync("git add .", { cwd: cloneDir, stdio: "pipe" });
    execSync("git -c commit.gpgsign=false commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git push origin main", { cwd: cloneDir, stdio: "pipe" });

    // First ingest: only path "a"
    const src1 = new DocSource({
      name: "sparse-test",
      type: "git",
      format: "markdown",
      url: repoDir,
      paths: ["a"],
    });
    const set1 = await ingestor.ingest(src1, workDir);
    expect(set1.hasFile("a/index.md")).toBe(true);
    expect(set1.hasFile("b/index.md")).toBe(false);

    // Second ingest on the SAME workDir: now request both "a" and "b".
    // The clone already exists — sparse-checkout must be re-applied.
    const src2 = new DocSource({
      name: "sparse-test",
      type: "git",
      format: "markdown",
      url: repoDir,
      paths: ["a", "b"],
    });
    const set2 = await ingestor.ingest(src2, workDir);
    expect(set2.hasFile("a/index.md")).toBe(true);
    expect(set2.hasFile("b/index.md")).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  }, 30_000);

  it("stores full 40-char SHA as version (not --short)", async () => {
    // Freshness check in UpdateDocSets compares remote full-SHA against
    // stamp.gitSha. If we stored a --short SHA, it would auto-disambiguate
    // to 7-10 chars and never match the full 40-char remote SHA.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-sha-"));
    const repoDir = path.join(tmpDir, "repo");
    const workDir = path.join(tmpDir, "work");
    await fs.mkdir(repoDir);
    await fs.mkdir(workDir);

    execSync("git init --bare --initial-branch=main", { cwd: repoDir, stdio: "pipe" });

    const cloneDir = path.join(tmpDir, "clone");
    execSync(`git clone ${repoDir} ${cloneDir}`, { stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git config user.name 'Test'", { cwd: cloneDir, stdio: "pipe" });
    await fs.writeFile(path.join(cloneDir, "README.md"), "# Hi");
    execSync("git add .", { cwd: cloneDir, stdio: "pipe" });
    execSync("git -c commit.gpgsign=false commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
    execSync("git push origin main", { cwd: cloneDir, stdio: "pipe" });

    const src = new DocSource({
      name: "sha-test",
      type: "git",
      format: "markdown",
      url: repoDir,
    });

    const set = await ingestor.ingest(src, workDir);

    expect(set.version).toBeDefined();
    expect(set.version).toMatch(/^[0-9a-f]{40}$/);

    await fs.rm(tmpDir, { recursive: true });
  }, 30_000);
});
