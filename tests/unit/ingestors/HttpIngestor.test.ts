import { describe, it, expect, vi } from "vitest";
import { HttpIngestor } from "../../../src/ingestors/HttpIngestor.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("HttpIngestor", () => {
  const ingestor = new HttpIngestor();

  it("supports http sources", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(true);
  });

  it("does not support git sources", () => {
    const src = new DocSource({ name: "x", type: "git", format: "markdown", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(false);
  });

  it("fetches urls and creates DocFiles", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<h1>Indexes</h1><p>About indexes.</p>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "postgres",
      type: "http",
      format: "html",
      url: "https://www.postgresql.org/docs/current/",
      urls: ["https://www.postgresql.org/docs/current/indexes.html"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.id).toBe("postgres");
    expect(set.size).toBe(1);

    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws if a url fetch fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const src = new DocSource({
      name: "postgres",
      type: "http",
      format: "html",
      url: "https://x.com",
      urls: ["https://x.com/notfound.html"],
    });

    await expect(ingestor.ingest(src, tmpDir)).rejects.toThrow("404");

    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true });
  });
});
