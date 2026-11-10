import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKETS, bucketDir, bucketOf, fnv1a, layerBuckets } from "../../../src/commands/layer-buckets.js";

describe("layer-buckets: hashing", () => {
  it("matches the FNV-1a 32-bit reference vectors", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });

  it("places a source in the same bucket every time, within range", () => {
    for (const name of ["supabase", "postgres", "cloudflare-api", "rfc"]) {
      const b = bucketOf(name);
      expect(b).toBe(bucketOf(name));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(BUCKETS);
    }
  });
});

describe("layer-buckets: layerBuckets", () => {
  it("moves source dirs into buckets, top-level files into top, zeroes times", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "layer-buckets-"));
    const docs = path.join(tmp, "docs");
    const out = path.join(tmp, "layers");
    await fs.mkdir(path.join(docs, "supabase", "guides"), { recursive: true });
    await fs.writeFile(path.join(docs, "supabase", "guides", "auth.md"), "# Auth\n");
    await fs.mkdir(path.join(docs, "postgres"));
    await fs.writeFile(path.join(docs, "postgres", "index.md"), "# PG\n");
    await fs.writeFile(path.join(docs, "_index.tsv"), "row\n");

    await layerBuckets(docs, out);

    const sb = path.join(out, bucketDir(bucketOf("supabase")), "docs", "supabase", "guides", "auth.md");
    expect(await fs.readFile(sb, "utf-8")).toBe("# Auth\n");
    const pg = path.join(out, bucketDir(bucketOf("postgres")), "docs", "postgres", "index.md");
    expect(await fs.readFile(pg, "utf-8")).toBe("# PG\n");
    expect(await fs.readFile(path.join(out, "top", "docs", "_index.tsv"), "utf-8")).toBe("row\n");
    expect(await fs.readdir(docs)).toEqual([]);

    // Every bucket exists, even empty ones (COPY fails on a missing source).
    for (let n = 0; n < BUCKETS; n++) {
      await expect(fs.stat(path.join(out, bucketDir(n), "docs"))).resolves.toBeTruthy();
    }
    for (const p of [sb, path.dirname(sb), path.join(out, "top", "docs", "_index.tsv"), out]) {
      expect((await fs.lstat(p)).mtimeMs).toBe(0);
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("layer-buckets: Dockerfile stays in sync", () => {
  it("copies every bucket plus top, in order, and no longer copies /docs whole", async () => {
    const dockerfile = await fs.readFile(fileURLToPath(new URL("../../../Dockerfile", import.meta.url)), "utf-8");
    const copies = [...dockerfile.matchAll(/^COPY --from=fetcher \/layers\/([0-9a-z]+)\/ \/$/gm)].map((m) => m[1]);
    const expected = [...Array.from({ length: BUCKETS }, (_, n) => bucketDir(n)), "top"];
    expect(copies).toEqual(expected);
    expect(dockerfile).not.toMatch(/^COPY --from=fetcher \/docs /m);
  });
});
