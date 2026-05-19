/**
 * Generates _source_groups.json from source tags.
 * Output is consumed by agents.sh at Docker runtime to populate
 * "Related source groups" without hardcoded lists.
 *
 * Usage: node --import tsx/esm src/commands/generate-source-groups.ts [outDir]
 *
 * The in-process fetch entrypoint (src/index.ts) writes the same file
 * as a post-fetch step using the same `buildSourceGroupsPayload`
 * helper; running this CLI standalone is useful only when you've
 * fetched docs through another path and want to regenerate the
 * agent-facing groups JSON without re-running the fetcher.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SOURCES } from "../application/sources.js";
import { SOURCE_TAGS, buildSourceGroupsPayload } from "../application/source-tags.js";

const outDir = process.argv[2] || process.env.DOCS_OUT_DIR || path.join(process.cwd(), "docs");

// Validate: every source in SOURCES should have tags
const untagged = SOURCES.filter((s) => !SOURCE_TAGS[s.name]).map((s) => s.name);
if (untagged.length) {
  console.warn(`[source-groups] WARNING: ${untagged.length} untagged sources: ${untagged.join(", ")}`);
}

const sourceNames = new Set(SOURCES.map((s) => s.name));
const output = buildSourceGroupsPayload(sourceNames);

const outPath = path.join(outDir, "_source_groups.json");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`Generated ${outPath} (${Object.keys(output).length} groups)`);
