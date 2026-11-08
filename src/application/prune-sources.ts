import fs from "node:fs/promises";
import path from "node:path";

/**
 * Delete top-level source directories under `outDir` that no longer match a
 * SOURCES entry (a renamed or removed source). The docs cache persists
 * across builds, so without this a renamed source is served twice
 * (jellyseerr next to seerr, docs-ssh#36). Root files and `_`/`.` entries
 * are left alone. Returns the names removed.
 */
export async function pruneRemovedSources(outDir: string, known: ReadonlySet<string>): Promise<string[]> {
  // Guard: an empty source list would delete every source directory.
  if (known.size === 0) return [];
  let entries;
  try {
    entries = await fs.readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    if (known.has(e.name)) continue;
    await fs.rm(path.join(outDir, e.name), { recursive: true, force: true });
    removed.push(e.name);
  }
  return removed.sort();
}
