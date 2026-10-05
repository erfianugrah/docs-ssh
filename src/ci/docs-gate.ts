/**
 * Pre-build gate over a fetched docs tree: the image must not ship with a
 * source missing, empty, or below its floor. Run 28 (2026-10-05) deployed an
 * image without flyio, flyio-api, whisparr-api, akamai, azure-key-vault and
 * ietf-rfc, and with 397 of ~3600 cloudflare-blog posts; the post-deploy
 * smoke only caught it after the old image was gone. This runs on the
 * fetched tree before `docker build`.
 *
 * A source that fails to fetch on a warm cache keeps its previous files, so
 * the gate only trips on a cold start, a new source, or a fetch that wrote a
 * degraded result.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface DocsTreeInput {
  /** File count per source directory present in the tree. */
  counts: Record<string, number>;
  /** Every source the image should contain (SOURCES names). */
  sourceNames: readonly string[];
  floors: Readonly<Record<string, number>>;
  /** Whether <source>/api/overview.md exists, keyed by API source. */
  overviews: Record<string, boolean>;
  apiSources: readonly string[];
  /** Sources allowed to be missing or empty (upstream blocks the fetch). */
  tolerated?: Readonly<Record<string, string>>;
}

/** Returns one human-readable problem per failing source; [] = pass. */
export function checkDocsTree(input: DocsTreeInput): string[] {
  const problems: string[] = [];
  for (const name of input.sourceNames) {
    const count = input.counts[name];
    if (input.tolerated?.[name] && !count) continue;
    if (count === undefined) {
      problems.push(`${name}: missing (no docs/${name} directory)`);
      continue;
    }
    if (count === 0) {
      problems.push(`${name}: 0 files`);
      continue;
    }
    const floor = input.floors[name];
    if (floor !== undefined && count < floor) {
      problems.push(`${name}: ${count} files, floor is ${floor}`);
    }
  }
  for (const name of input.apiSources) {
    if (input.sourceNames.includes(name) && input.counts[name] && input.overviews[name] === false) {
      problems.push(`${name}: no api/overview.md`);
    }
  }
  return problems;
}

/** Counts non-dot files under each top-level directory of docsDir. */
export function countDocsTree(docsDir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of fs.readdirSync(docsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    counts[entry.name] = countFiles(path.join(docsDir, entry.name));
  }
  return counts;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(p);
    else if (entry.isFile()) n++;
  }
  return n;
}
