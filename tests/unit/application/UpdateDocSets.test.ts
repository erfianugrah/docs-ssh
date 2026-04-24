import { describe, it, expect } from "vitest";
import { UpdateDocSets } from "../../../src/application/UpdateDocSets.js";
import { DocFile } from "../../../src/domain/DocFile.js";
import { DocSet } from "../../../src/domain/DocSet.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import type { DocIngestor } from "../../../src/domain/DocIngestor.js";
import type { DocNormaliser } from "../../../src/domain/DocNormaliser.js";
import type { DocFormat } from "../../../src/domain/DocSource.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const makeSource = (name = "test-source") =>
  new DocSource({ name, type: "http", format: "markdown", url: "https://example.com/" });

/** A mock ingestor that returns a pre-built DocSet */
function mockIngestor(docSet: DocSet): DocIngestor {
  return {
    name: "MockIngestor",
    supports: () => true,
    ingest: async () => docSet,
  };
}

/** A pass-through normaliser that does nothing */
const noopNormaliser: DocNormaliser = {
  name: "NoopNormaliser",
  supports: () => false,
  supportsFormat: () => false,
  normalise: async (file) => file,
};

describe("UpdateDocSets", () => {
  describe("write", () => {
    it("writes files to the output directory", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-test-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeSource();
      const files = new Map([
        ["guide.md", new DocFile("guide.md", "# Guide\nContent here.")],
        ["nested/auth.md", new DocFile("nested/auth.md", "# Auth")],
      ]);
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
      });

      const results = await updater.run();

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
      expect(results[0].diff?.added).toBe(2);

      // Verify files were written
      const guideContent = await fs.readFile(path.join(outDir, "test-source", "guide.md"), "utf-8");
      expect(guideContent).toBe("# Guide\nContent here.");
      const authContent = await fs.readFile(path.join(outDir, "test-source", "nested/auth.md"), "utf-8");
      expect(authContent).toBe("# Auth");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("removes files that no longer exist in the updated DocSet", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-test-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeSource();
      const sourceDir = path.join(outDir, "test-source");

      // Pre-populate the output directory with an existing file
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, "old-file.md"), "# Old file to be removed");
      await fs.writeFile(path.join(sourceDir, "kept.md"), "# Kept");

      // New DocSet only has "kept.md" — "old-file.md" should be removed
      const files = new Map([
        ["kept.md", new DocFile("kept.md", "# Kept (updated)")],
      ]);
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
      });

      const results = await updater.run();

      expect(results[0].status).toBe("ok");
      expect(results[0].diff?.removed).toBe(1);
      expect(results[0].diff?.modified).toBe(1); // "kept.md" content changed

      // old-file.md should be gone
      await expect(fs.access(path.join(sourceDir, "old-file.md"))).rejects.toThrow();
      // kept.md should have new content
      const content = await fs.readFile(path.join(sourceDir, "kept.md"), "utf-8");
      expect(content).toBe("# Kept (updated)");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("computes correct diff for unchanged files", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-test-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeSource();
      const sourceDir = path.join(outDir, "test-source");

      // Pre-populate with identical content
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, "same.md"), "# Unchanged");

      const files = new Map([
        ["same.md", new DocFile("same.md", "# Unchanged")],
      ]);
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
      });

      const results = await updater.run();

      expect(results[0].status).toBe("ok");
      expect(results[0].diff?.unchanged).toBe(1);
      expect(results[0].diff?.added).toBe(0);
      expect(results[0].diff?.modified).toBe(0);
      expect(results[0].diff?.removed).toBe(0);

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe("error handling", () => {
    it("reports error when no ingestor matches", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-test-"));

      const source = makeSource();
      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [], // no ingestors
        normalisers: [noopNormaliser],
        outDir: tmpDir,
        workDir: tmpDir,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("error");
      expect(results[0].error).toContain("No ingestor found");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("catches ingestor errors and continues", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-test-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source1 = new DocSource({ name: "failing", type: "http", format: "markdown", url: "https://example.com/" });
      const source2 = new DocSource({ name: "succeeding", type: "http", format: "markdown", url: "https://example.com/" });

      const failingIngestor: DocIngestor = {
        name: "FailingIngestor",
        supports: (s) => s.name === "failing",
        ingest: async () => { throw new Error("Network failure"); },
      };

      const files = new Map([["ok.md", new DocFile("ok.md", "# OK")]]);
      const successIngestor = mockIngestor(new DocSet(source2, files));
      successIngestor.supports = (s) => s.name === "succeeding";

      const updater = new UpdateDocSets({
        sources: [source1, source2],
        ingestors: [failingIngestor, successIngestor],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
      });

      const results = await updater.run();
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("error");
      expect(results[0].error).toContain("Network failure");
      expect(results[1].status).toBe("ok");

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe("git freshness check", () => {
    /**
     * Directly exercise the private checkGitFreshness method against
     * a real local bare repo. Covers full-SHA equality + legacy short-SHA
     * prefix match so an upgrade from older stamp formats is seamless.
     */
    async function makeRepo(): Promise<{ url: string; sha: string; cleanup: () => Promise<void> }> {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-git-"));
      const repoDir = path.join(tmpDir, "repo");
      const cloneDir = path.join(tmpDir, "clone");
      await fs.mkdir(repoDir);
      const { execSync } = await import("node:child_process");
      execSync("git init --bare --initial-branch=main", { cwd: repoDir, stdio: "pipe" });
      execSync(`git clone ${repoDir} ${cloneDir}`, { stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", { cwd: cloneDir, stdio: "pipe" });
      execSync("git config user.name 'Test'", { cwd: cloneDir, stdio: "pipe" });
      await fs.writeFile(path.join(cloneDir, "README.md"), "# Hi");
      execSync("git add .", { cwd: cloneDir, stdio: "pipe" });
      execSync("git commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
      execSync("git push origin main", { cwd: cloneDir, stdio: "pipe" });
      const sha = execSync("git rev-parse HEAD", { cwd: cloneDir, encoding: "utf-8" }).trim();
      return {
        url: repoDir,
        sha,
        cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
      };
    }

    it("returns true when stamp has full 40-char SHA matching remote", async () => {
      const { url, sha, cleanup } = await makeRepo();
      const source = new DocSource({ name: "r", type: "git", format: "markdown", url });
      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [],
        normalisers: [],
        outDir: "",
        workDir: "",
      });
      const fresh = await (updater as any).checkGitFreshness(source, { fetchedAt: "", gitSha: sha });
      expect(fresh).toBe(true);
      await cleanup();
    }, 15_000);

    it("returns true for legacy short SHA that prefixes the full remote SHA", async () => {
      const { url, sha, cleanup } = await makeRepo();
      const source = new DocSource({ name: "r", type: "git", format: "markdown", url });
      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [],
        normalisers: [],
        outDir: "",
        workDir: "",
      });
      // Simulate an old stamp written with `git rev-parse --short` (7-10 chars).
      const legacyShort = sha.slice(0, 9);
      const fresh = await (updater as any).checkGitFreshness(source, { fetchedAt: "", gitSha: legacyShort });
      expect(fresh).toBe(true);
      await cleanup();
    }, 15_000);

    it("returns false when stamp SHA does not match remote", async () => {
      const { url, cleanup } = await makeRepo();
      const source = new DocSource({ name: "r", type: "git", format: "markdown", url });
      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [],
        normalisers: [],
        outDir: "",
        workDir: "",
      });
      const bogus = "0000000000000000000000000000000000000000";
      const fresh = await (updater as any).checkGitFreshness(source, { fetchedAt: "", gitSha: bogus });
      expect(fresh).toBe(false);
      await cleanup();
    }, 15_000);
  });
});
