import { describe, it, expect, vi, afterEach } from "vitest";
import { UpdateDocSets, BatchProgress } from "../../../src/application/UpdateDocSets.js";
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

/** Source that won't trigger network calls in captureFreshness (git path is offline). */
const makeOfflineSource = (name = "test-source") =>
  new DocSource({ name, type: "git", format: "markdown", url: "https://example.com/repo.git" });

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

  describe("regression guard", () => {
    it("rejects a fetch that drops below the threshold", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest");

      // Pre-write a stamp claiming the previous run produced 100 files.
      const stampDir = path.join(outDir, "regtest");
      await fs.mkdir(stampDir, { recursive: true });
      await fs.writeFile(
        path.join(stampDir, ".stamp.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 100 }),
      );

      // Mock ingestor returns just 10 files — 10% of previous, below 50% default.
      const files = new Map();
      for (let i = 0; i < 10; i++) {
        files.set(`p${i}.md`, new DocFile(`p${i}.md`, `# Page ${i}`));
      }
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0, // skip freshness; force re-fetch
      });

      const results = await updater.run();
      expect(results[0].status).toBe("error");
      expect(results[0].error).toMatch(/regression/);
      expect(results[0].error).toMatch(/10 files vs previous 100/);

      await fs.rm(tmpDir, { recursive: true });
    });

    it("accepts a fetch that drops within the threshold", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest2");
      const stampDir = path.join(outDir, "regtest2");
      await fs.mkdir(stampDir, { recursive: true });
      await fs.writeFile(
        path.join(stampDir, ".stamp.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 100 }),
      );

      // 70 files — 70% of previous, above 50% default.
      const files = new Map();
      for (let i = 0; i < 70; i++) {
        files.set(`p${i}.md`, new DocFile(`p${i}.md`, `# Page ${i}`));
      }
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("ok");

      // Stamp should now record the new count (70).
      const newStamp = JSON.parse(
        await fs.readFile(path.join(stampDir, ".stamp.json"), "utf-8"),
      );
      expect(newStamp.fileCount).toBe(70);

      await fs.rm(tmpDir, { recursive: true });
    });

    it("does nothing on first fetch (no previous stamp)", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest3");
      const files = new Map([["p.md", new DocFile("p.md", "# OK")]]);
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("ok");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("rejects a fetch that grows beyond the upper bound (1 / threshold)", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest-grow");
      const stampDir = path.join(outDir, "regtest-grow");
      await fs.mkdir(stampDir, { recursive: true });
      await fs.writeFile(
        path.join(stampDir, ".stamp.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 10 }),
      );

      // 30 files — 300% of previous, above the default upper band (200%).
      // Symmetric guard: a sudden tripling is just as suspicious as a halving.
      const files = new Map();
      for (let i = 0; i < 30; i++) {
        files.set(`p${i}.md`, new DocFile(`p${i}.md`, `# Page ${i}`));
      }
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("error");
      expect(results[0].error).toMatch(/regression \(growth\)/);
      expect(results[0].error).toMatch(/30 files vs previous 10/);

      await fs.rm(tmpDir, { recursive: true });
    });

    it("accepts a fetch that grows within the upper band", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest-grow-ok");
      const stampDir = path.join(outDir, "regtest-grow-ok");
      await fs.mkdir(stampDir, { recursive: true });
      await fs.writeFile(
        path.join(stampDir, ".stamp.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 10 }),
      );

      // 15 files — 150% of previous, inside the default 50%-200% band.
      const files = new Map();
      for (let i = 0; i < 15; i++) {
        files.set(`p${i}.md`, new DocFile(`p${i}.md`, `# Page ${i}`));
      }
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("ok");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("disabled when regressionThreshold is 0", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-reg-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource("regtest4");
      const stampDir = path.join(outDir, "regtest4");
      await fs.mkdir(stampDir, { recursive: true });
      await fs.writeFile(
        path.join(stampDir, ".stamp.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 100 }),
      );
      // Drop to 1 file — would trip the default threshold.
      const files = new Map([["p.md", new DocFile("p.md", "# OK")]]);
      const docSet = new DocSet(source, files);

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        maxAge: 0,
        regressionThreshold: 0,
      });

      const results = await updater.run();
      expect(results[0].status).toBe("ok");

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe("per-source deadline", () => {
    it("fails a source that exceeds sourceDeadline without blocking others", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-deadline-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const hungSource = new DocSource({ name: "hung", type: "http", format: "markdown", url: "https://example.com/" });
      const fastSource = new DocSource({ name: "fast", type: "http", format: "markdown", url: "https://example.com/" });

      const hungIngestor: DocIngestor = {
        name: "HungIngestor",
        supports: (s) => s.name === "hung",
        // never resolves
        ingest: () => new Promise(() => {}),
      };
      const files = new Map([["ok.md", new DocFile("ok.md", "# OK")]]);
      const fastIngestor = mockIngestor(new DocSet(fastSource, files));
      fastIngestor.supports = (s) => s.name === "fast";

      const updater = new UpdateDocSets({
        sources: [hungSource, fastSource],
        ingestors: [hungIngestor, fastIngestor],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
        // 500ms — short enough for the test to be fast, long enough
        // that the "fast" mock source (which does fs.mkdir + fs.writeFile
        // + stamp write under tmpfs/spinning disk on CI) actually has
        // time to complete before the deadline can fire on it.
        sourceDeadline: 500,
      });

      const start = Date.now();
      const results = await updater.run();
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(2);
      const hung = results.find((r) => r.source === "hung");
      const fast = results.find((r) => r.source === "fast");
      expect(hung?.status).toBe("error");
      expect(hung?.error).toMatch(/deadline exceeded/);
      expect(fast?.status).toBe("ok");
      // Deadline caps total runtime — should not take much longer than
      // the deadline itself even with the hung source.
      expect(elapsed).toBeLessThan(2000);

      await fs.rm(tmpDir, { recursive: true });
    });
  });

  describe("BatchProgress", () => {
    // Snapshot + restore real console so these tests don't pollute output
    // if they fail partway through.
    const real = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };

    afterEach(() => {
      console.log = real.log;
      console.warn = real.warn;
      console.error = real.error;
    });

    it("buffers console output during batch in TTY mode", () => {
      const progress = new BatchProgress({ isTTY: true });
      const spy = vi.fn();
      console.log = spy;
      console.warn = spy;
      console.error = spy;

      progress.start(["source-a", "source-b"]);
      // Ingestor code calls console during the batch
      console.log("progress message");
      console.warn("warning");
      console.error("error");

      // Nothing should have been passed to the spy yet — the batch is
      // still active and messages are queued for later replay.
      expect(spy).not.toHaveBeenCalledWith("progress message");
      expect(spy).not.toHaveBeenCalledWith("warning");
      expect(spy).not.toHaveBeenCalledWith("error");
    });

    it("replays buffered messages on finish() in TTY mode", () => {
      const progress = new BatchProgress({ isTTY: true });
      const logSpy = vi.fn();
      const warnSpy = vi.fn();
      const errorSpy = vi.fn();
      console.log = logSpy;
      console.warn = warnSpy;
      console.error = errorSpy;

      progress.start(["source-a"]);
      console.log("queued log", 1);
      console.warn("queued warn");
      console.error("queued error");
      progress.finish();

      // After finish the buffer is flushed to the restored console.
      expect(logSpy).toHaveBeenCalledWith("queued log", 1);
      expect(warnSpy).toHaveBeenCalledWith("queued warn");
      expect(errorSpy).toHaveBeenCalledWith("queued error");
    });

    it("preserves ordering of buffered messages", () => {
      const progress = new BatchProgress({ isTTY: true });
      const calls: string[] = [];
      console.log = (...a: unknown[]) => { calls.push(`log:${a.join(",")}`); };
      console.warn = (...a: unknown[]) => { calls.push(`warn:${a.join(",")}`); };

      progress.start(["x"]);
      console.log("a");
      console.warn("b");
      console.log("c");
      progress.finish();

      expect(calls).toEqual(["log:a", "warn:b", "log:c"]);
    });

    it("does not touch console in non-TTY mode (logs pass through)", () => {
      const progress = new BatchProgress({ isTTY: false });
      const spy = vi.fn();
      console.log = spy;

      progress.start(["source-a"]);
      console.log("passthrough");
      progress.finish();

      // In non-TTY mode the logs go straight to the original console;
      // the spy is called immediately (not via buffer replay).
      expect(spy).toHaveBeenCalledWith("passthrough");
    });

    it("clears buffer between batches", () => {
      const progress = new BatchProgress({ isTTY: true });
      const spy = vi.fn();
      console.log = spy;

      progress.start(["a"]);
      console.log("batch1");
      progress.finish();
      spy.mockClear();

      progress.start(["b"]);
      // No message queued this time
      progress.finish();

      // Should not re-emit batch1
      expect(spy).not.toHaveBeenCalled();
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
      execSync("git -c commit.gpgsign=false commit -m 'init'", { cwd: cloneDir, stdio: "pipe" });
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

  describe("negotiation stamp + drift detection", () => {
    it("persists DocSet.negotiation to the stamp file after a successful fetch", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-stamp-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource();
      const docSet = new DocSet(
        source,
        new Map([["a.md", new DocFile("a.md", "# A")]]),
        new Date(),
        undefined,
        {
          markdown: 9,
          html: 0,
          fallback404: 1,
          fallbackThin: 0,
          fallbackLyingCt: 0,
          totalTokens: 12345,
        },
      );

      const updater = new UpdateDocSets({
        sources: [source],
        ingestors: [mockIngestor(docSet)],
        normalisers: [noopNormaliser],
        outDir,
        workDir,
      });

      await updater.run();

      const stamp = JSON.parse(
        await fs.readFile(path.join(outDir, "test-source", ".stamp.json"), "utf-8"),
      );
      expect(stamp.negotiation).toEqual({
        markdown: 9,
        html: 0,
        fallback404: 1,
        fallbackThin: 0,
        fallbackLyingCt: 0,
        totalTokens: 12345,
      });

      await fs.rm(tmpDir, { recursive: true });
    });

    it("logs adoption drift when markdown rate changes by more than 25 percentage points", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-drift-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource();
      const sourceDir = path.join(outDir, "test-source");
      await fs.mkdir(sourceDir, { recursive: true });

      // Seed a previous stamp where 100% of pages were markdown
      await fs.writeFile(
        path.join(sourceDir, ".stamp.json"),
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          fileCount: 10,
          negotiation: {
            markdown: 10,
            html: 0,
            fallback404: 0,
            fallbackThin: 0,
            fallbackLyingCt: 0,
            totalTokens: 5000,
          },
        }),
      );

      // New fetch: zone owner disabled the toggle, all responses are HTML now
      const newDocSet = new DocSet(
        source,
        new Map([
          ["a.md", new DocFile("a.md", "# A")],
          ["b.md", new DocFile("b.md", "# B")],
        ]),
        new Date(),
        undefined,
        {
          markdown: 0,
          html: 10,
          fallback404: 0,
          fallbackThin: 0,
          fallbackLyingCt: 0,
          totalTokens: 0,
        },
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const updater = new UpdateDocSets({
          sources: [source],
          ingestors: [mockIngestor(newDocSet)],
          normalisers: [noopNormaliser],
          outDir,
          workDir,
          // Disable regression guard since we're testing drift, not file-count change
          regressionThreshold: 0,
        });
        await updater.run();
      } finally {
        console.log = origLog;
      }

      const driftLog = logs.find((l) => l.includes("markdown adoption"));
      expect(driftLog).toBeDefined();
      expect(driftLog).toMatch(/down/);
      expect(driftLog).toContain("100% → 0%");
      expect(driftLog).toContain("-100pp");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("does NOT log drift when adoption stays within the 25pp threshold", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-no-drift-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource();
      const sourceDir = path.join(outDir, "test-source");
      await fs.mkdir(sourceDir, { recursive: true });

      // Previous: 100% markdown
      await fs.writeFile(
        path.join(sourceDir, ".stamp.json"),
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          fileCount: 10,
          negotiation: {
            markdown: 10,
            html: 0,
            fallback404: 0,
            fallbackThin: 0,
            fallbackLyingCt: 0,
            totalTokens: 5000,
          },
        }),
      );

      // Current: 90% markdown (10pp drop — within threshold)
      const newDocSet = new DocSet(
        source,
        new Map([["a.md", new DocFile("a.md", "# A")]]),
        new Date(),
        undefined,
        {
          markdown: 9,
          html: 1,
          fallback404: 0,
          fallbackThin: 0,
          fallbackLyingCt: 0,
          totalTokens: 4500,
        },
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const updater = new UpdateDocSets({
          sources: [source],
          ingestors: [mockIngestor(newDocSet)],
          normalisers: [noopNormaliser],
          outDir,
          workDir,
          regressionThreshold: 0,
        });
        await updater.run();
      } finally {
        console.log = origLog;
      }

      expect(logs.find((l) => l.includes("markdown adoption"))).toBeUndefined();

      await fs.rm(tmpDir, { recursive: true });
    });

    it("does NOT log drift when previous stamp has no negotiation data (first time)", async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-first-"));
      const outDir = path.join(tmpDir, "out");
      const workDir = path.join(tmpDir, "work");
      await fs.mkdir(outDir, { recursive: true });
      await fs.mkdir(workDir, { recursive: true });

      const source = makeOfflineSource();
      const sourceDir = path.join(outDir, "test-source");
      await fs.mkdir(sourceDir, { recursive: true });

      // Legacy stamp without negotiation field
      await fs.writeFile(
        path.join(sourceDir, ".stamp.json"),
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          fileCount: 10,
        }),
      );

      const newDocSet = new DocSet(
        source,
        new Map([["a.md", new DocFile("a.md", "# A")]]),
        new Date(),
        undefined,
        {
          markdown: 10,
          html: 0,
          fallback404: 0,
          fallbackThin: 0,
          fallbackLyingCt: 0,
          totalTokens: 1000,
        },
      );

      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const updater = new UpdateDocSets({
          sources: [source],
          ingestors: [mockIngestor(newDocSet)],
          normalisers: [noopNormaliser],
          outDir,
          workDir,
          regressionThreshold: 0,
        });
        await updater.run();
      } finally {
        console.log = origLog;
      }

      // No drift log on the first fetch — there's no baseline yet.
      expect(logs.find((l) => l.includes("markdown adoption"))).toBeUndefined();

      await fs.rm(tmpDir, { recursive: true });
    });
  });
});
