/**
 * Splits the built docs tree into a fixed set of image-layer buckets so a
 * rebuild only ships the buckets whose sources changed (docs-ssh#38).
 *
 * Before this, `COPY --from=fetcher /docs /docs` produced ONE 1.17 GB layer
 * (520 MB compressed on ghcr, 2026-11-10), and every scheduled or release
 * build pushed and pulled all of it even when a handful of the ~430 sources
 * changed. Registries and the Docker daemon dedupe layers by digest, so a
 * layer whose bytes are identical to the previous build's is neither pushed
 * nor pulled again. Two things make that work:
 *
 *   1. Stable placement: each source directory lands in bucket
 *      fnv1a(name) % BUCKETS, so adding or removing a source only touches its
 *      own bucket, never reshuffles the others.
 *   2. Deterministic bytes: every path under the output gets mtime/atime 0.
 *      The fetcher rewrites files on each run, so their real mtimes change
 *      even when content does not, and the layer tar records mtimes. Nothing
 *      at runtime reads doc mtimes (checked 2026-11-10: commands/, src/mcp/).
 *
 * Layout written (moves, not copies - same filesystem):
 *
 *   <out>/NN/docs/<source>/...   NN = 00..BUCKETS-1, every bucket created
 *                                even when empty (COPY fails on a missing src)
 *   <out>/top/docs/<file>        top-level files (_index.tsv, ...): these
 *                                change on every content change, so they get
 *                                their own small layer, copied last
 *
 * The runtime stage of the Dockerfile has one `COPY --from=fetcher
 * /layers/NN/ /` per bucket plus one for `top`; tests/unit/commands/
 * layer-buckets.test.ts keeps that list and BUCKETS in sync.
 *
 * Usage:
 *   node --import tsx/esm src/commands/layer-buckets.ts /docs /layers
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Number of bucket layers. Changing it reshuffles every bucket once. */
export const BUCKETS = 32;

/** FNV-1a 32-bit over the UTF-8 bytes of `name`. */
export function fnv1a(name: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(name, "utf-8")) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function bucketOf(name: string, buckets = BUCKETS): number {
  return fnv1a(name) % buckets;
}

export function bucketDir(n: number): string {
  return String(n).padStart(2, "0");
}

/** Set atime+mtime to the epoch on `root` and everything below it. */
export async function zeroTimes(root: string): Promise<void> {
  const st = await fs.lstat(root);
  if (st.isDirectory()) {
    for (const entry of await fs.readdir(root)) {
      await zeroTimes(path.join(root, entry));
    }
  }
  // lutimes: never follow a symlink out of the tree.
  await fs.lutimes(root, 0, 0);
}

/**
 * rename, falling back to copy + delete on EXDEV. Inside a Docker build
 * /docs comes from an earlier RUN, i.e. a lower overlayfs layer, and
 * overlayfs refuses to rename a lower-layer directory (EXDEV, seen on the
 * first build 2026-11-10). A plain rename still covers host-side runs.
 */
async function move(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(src, dest, { recursive: true, verbatimSymlinks: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

export async function layerBuckets(docsDir: string, outDir: string, buckets = BUCKETS): Promise<void> {
  for (let n = 0; n < buckets; n++) {
    await fs.mkdir(path.join(outDir, bucketDir(n), "docs"), { recursive: true });
  }
  await fs.mkdir(path.join(outDir, "top", "docs"), { recursive: true });

  for (const entry of await fs.readdir(docsDir, { withFileTypes: true })) {
    const src = path.join(docsDir, entry.name);
    const dest = entry.isDirectory()
      ? path.join(outDir, bucketDir(bucketOf(entry.name, buckets)), "docs", entry.name)
      : path.join(outDir, "top", "docs", entry.name);
    await move(src, dest);
  }

  await zeroTimes(outDir);
}

// ─── Main ──────────────────────────────────────────────────────────
// Only runs when invoked as a script. Allows direct import from tests.

const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;

if (invokedAsScript) {
  const docsDir = process.argv[2] ?? "/docs";
  const outDir = process.argv[3] ?? "/layers";
  await layerBuckets(docsDir, outDir);
}
