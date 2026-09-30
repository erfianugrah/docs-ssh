import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DocFile } from "../domain/DocFile.js";

/**
 * Origin-URL plumbing.
 *
 * Every fetched file may carry the public URL it came from (`DocFile.originUrl`).
 * That mapping is persisted PER SOURCE inside the source's freshness stamp
 * (`<outDir>/<source>/.stamp.json`), which is rewritten only on a real fetch.
 * A cached run (freshness hit, no fetch) therefore keeps its previous origin
 * map intact - and the merged root-level view can always be rebuilt from the
 * stamps on disk.
 *
 * The merged file is `<outDir>/_origins.tsv`:
 *
 *     <source>/<relpath.md>\t<url>
 *
 * It lives at the docs root, never inside a source dir, because the smoke
 * tests require source directories to contain markdown only.
 */
export const ORIGINS_FILENAME = "_origins.tsv";

/** Build the path -> origin URL map for a freshly normalised doc set. */
export function collectOrigins(files: Iterable<DocFile>): Record<string, string> {
  const origins: Record<string, string> = {};
  for (const file of files) {
    if (file.originUrl) origins[file.path] = file.originUrl;
  }
  return origins;
}

/** Read the origin map persisted in a source's stamp, or {} when absent. */
export async function readSourceOrigins(
  outDir: string,
  sourceName: string,
): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(outDir, sourceName, ".stamp.json"), "utf-8");
    const parsed = JSON.parse(raw) as { origins?: Record<string, string> };
    return parsed.origins ?? {};
  } catch {
    // Missing / unreadable stamp = no known origins for this source.
    return {};
  }
}

/**
 * Merge every source's stamp origins into `<outDir>/_origins.tsv`.
 * Returns the number of entries written.
 */
export async function writeOriginsTsv(
  outDir: string,
  sourceNames: readonly string[],
): Promise<number> {
  const lines: string[] = [];
  for (const name of [...sourceNames].sort()) {
    const origins = await readSourceOrigins(outDir, name);
    for (const rel of Object.keys(origins).sort()) {
      lines.push(`${name}/${rel}\t${origins[rel]}`);
    }
  }
  const body = lines.length > 0 ? lines.join("\n") + "\n" : "";
  await fs.writeFile(path.join(outDir, ORIGINS_FILENAME), body);
  return lines.length;
}
