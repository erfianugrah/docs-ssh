import { describe, it, expect } from "vitest";
import { GitIngestor } from "../../../src/ingestors/GitIngestor.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

describe("GitIngestor", () => {
  const ingestor = new GitIngestor();

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
    execSync("git commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
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
});
