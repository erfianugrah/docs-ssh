import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ORIGINS_FILENAME,
  collectOrigins,
  readSourceOrigins,
  writeOriginsTsv,
} from "../../../src/application/origins.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("collectOrigins", () => {
  it("keeps only files with an origin URL", () => {
    const files = [
      new DocFile("a.md", "x", { originUrl: "https://example.com/a" }),
      new DocFile("b.md", "x"),
      new DocFile("c.md", "x", { originUrl: "https://example.com/c" }),
    ];
    expect(collectOrigins(files)).toEqual({
      "a.md": "https://example.com/a",
      "c.md": "https://example.com/c",
    });
  });

  it("survives a path rewrite (normalisation)", () => {
    const rewritten = new DocFile("a.mdx", "x", {
      originUrl: "https://example.com/a",
    }).withPath("a.md");
    expect(collectOrigins([rewritten])).toEqual({ "a.md": "https://example.com/a" });
  });
});

describe("writeOriginsTsv", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "origins-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeStamp(source: string, origins: Record<string, string>) {
    const sourceDir = path.join(dir, source);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, ".stamp.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString(), fileCount: 1, origins }),
    );
  }

  it("merges every source's stamp into a root-level tsv", async () => {
    await writeStamp("beta", { "b.md": "https://example.com/b" });
    await writeStamp("alpha", {
      "guides/a.md": "https://example.com/a",
      "z.md": "https://example.com/z",
    });

    const count = await writeOriginsTsv(dir, ["beta", "alpha"]);
    const raw = await fs.readFile(path.join(dir, ORIGINS_FILENAME), "utf-8");

    expect(count).toBe(3);
    expect(raw).toBe(
      "alpha/guides/a.md\thttps://example.com/a\n" +
        "alpha/z.md\thttps://example.com/z\n" +
        "beta/b.md\thttps://example.com/b\n",
    );
  });

  it("writes an empty file when no source has origins (missing stamps)", async () => {
    const count = await writeOriginsTsv(dir, ["absent"]);
    expect(count).toBe(0);
    expect(await fs.readFile(path.join(dir, ORIGINS_FILENAME), "utf-8")).toBe("");
  });

  it("tolerates a corrupt stamp", async () => {
    const sourceDir = path.join(dir, "broken");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, ".stamp.json"), "{not json");
    expect(await readSourceOrigins(dir, "broken")).toEqual({});
  });

  it("a cached run (stamp untouched) keeps its origins", async () => {
    await writeStamp("alpha", { "a.md": "https://example.com/a" });
    await writeOriginsTsv(dir, ["alpha"]);
    // Simulate a later no-fetch run writing the merged file again.
    await writeOriginsTsv(dir, ["alpha"]);
    expect(await fs.readFile(path.join(dir, ORIGINS_FILENAME), "utf-8")).toBe(
      "alpha/a.md\thttps://example.com/a\n",
    );
  });
});
