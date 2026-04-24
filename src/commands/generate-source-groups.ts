/**
 * Generates _source_groups.json from source tags.
 * Output is consumed by agents.sh at Docker runtime to populate
 * "Related source groups" without hardcoded lists.
 *
 * Usage: node --import tsx/esm src/commands/generate-source-groups.ts [outDir]
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SOURCES } from "../application/sources.js";
import { SOURCE_TAGS, TAG_LABELS, buildSourceGroups } from "../application/source-tags.js";

const outDir = process.argv[2] || process.env.DOCS_OUT_DIR || path.join(process.cwd(), "docs");

// Validate: every source in SOURCES should have tags
const untagged = SOURCES.filter((s) => !SOURCE_TAGS[s.name]).map((s) => s.name);
if (untagged.length) {
  console.warn(`[source-groups] WARNING: ${untagged.length} untagged sources: ${untagged.join(", ")}`);
}

const groups = buildSourceGroups();

// Only include groups where at least one source actually exists in SOURCES
const sourceNames = new Set(SOURCES.map((s) => s.name));
const output: Record<string, { label: string; sources: string[] }> = {};
for (const [tag, names] of groups) {
  const existing = names.filter((n) => sourceNames.has(n));
  if (existing.length) {
    output[tag] = { label: TAG_LABELS[tag] ?? tag, sources: existing };
  }
}

const outPath = path.join(outDir, "_source_groups.json");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Generated ${outPath} (${Object.keys(output).length} groups)`);
