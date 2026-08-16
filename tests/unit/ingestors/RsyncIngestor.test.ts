import { describe, it, expect, beforeAll } from "vitest";
import { RsyncIngestor } from "../../../src/ingestors/RsyncIngestor.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

let hasRsync = false;
try {
  execFileSync("rsync", ["--version"], { stdio: "pipe" });
  hasRsync = true;
} catch {
  hasRsync = false;
}

describe("RsyncIngestor", () => {
  const ingestor = new RsyncIngestor({ retries: 1, base: 10, jitter: 0 });

  it("supports rsync sources", () => {
    const src = new DocSource({ name: "x", type: "rsync", format: "txt", url: "host::mod" });
    expect(ingestor.supports(src)).toBe(true);
  });

  it("does not support git or http sources", () => {
    expect(
      ingestor.supports(new DocSource({ name: "x", type: "git", format: "markdown", url: "u" })),
    ).toBe(false);
    expect(
      ingestor.supports(new DocSource({ name: "x", type: "http", format: "html", url: "u" })),
    ).toBe(false);
  });

  // rsync treats a plain local path as a module source - no network needed.
  (hasRsync ? describe : describe.skip)("local-path sync", () => {
    let moduleDir: string;
    let workDir: string;

    beforeAll(async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rsync-ingest-test-"));
      moduleDir = path.join(tmp, "module");
      workDir = path.join(tmp, "work");
      await fs.mkdir(path.join(moduleDir, "bcp"), { recursive: true });
      await fs.writeFile(path.join(moduleDir, "rfc1.txt"), "rfc one");
      await fs.writeFile(path.join(moduleDir, "rfc2.txt"), "rfc two");
      await fs.writeFile(path.join(moduleDir, "bcp", "bcp9.txt"), "bcp nine");
      await fs.writeFile(path.join(moduleDir, "notes.md"), "not text - excluded");
    });

    it("collects .txt files recursively, excluding other extensions", async () => {
      const src = new DocSource({ name: "ietf-rfc", type: "rsync", format: "txt", url: moduleDir });
      const set = await ingestor.ingest(src, workDir);
      expect(set.source.name).toBe("ietf-rfc");
      expect(set.getFile("rfc1.txt")?.content).toBe("rfc one");
      expect(set.getFile("rfc2.txt")?.content).toBe("rfc two");
      expect(set.getFile("bcp/bcp9.txt")?.content).toBe("bcp nine");
      expect(set.getFile("notes.md")).toBeUndefined();
      expect(set.size).toBe(3);
    });

    it("applies urlExclude to relative paths", async () => {
      const src = new DocSource({
        name: "ietf-rfc",
        type: "rsync",
        format: "txt",
        url: moduleDir,
        urlExclude: "^bcp/",
      });
      const set = await ingestor.ingest(src, workDir);
      expect(set.size).toBe(2);
      expect(set.getFile("bcp/bcp9.txt")).toBeUndefined();
    });

    it("fails cleanly on a nonexistent module", async () => {
      const src = new DocSource({
        name: "ietf-rfc",
        type: "rsync",
        format: "txt",
        url: path.join(moduleDir, "does-not-exist"),
      });
      await expect(ingestor.ingest(src, workDir)).rejects.toThrow();
    });
  });
});
