import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitIngestor } from "./ingestors/GitIngestor.js";
import { HttpIngestor } from "./ingestors/HttpIngestor.js";
import { MdxNormaliser } from "./normaliser/MdxNormaliser.js";
import { HtmlNormaliser } from "./normaliser/HtmlNormaliser.js";
import { GoNormaliser } from "./normaliser/GoNormaliser.js";
import { MarkdownCleaner } from "./normaliser/MarkdownCleaner.js";
import { ContentSanitiser } from "./normaliser/ContentSanitiser.js";
import { UpdateDocSets } from "./application/UpdateDocSets.js";
import { SOURCES } from "./application/sources.js";
import { SOURCE_TAGS, buildSourceGroupsPayload } from "./application/source-tags.js";

const OUT_DIR = process.env.DOCS_OUT_DIR ?? path.join(process.cwd(), "docs");
const WORK_DIR = process.env.DOCS_WORK_DIR ?? path.join(os.tmpdir(), "docs-ssh-work");
const CONCURRENCY = parseInt(process.env.DOCS_CONCURRENCY ?? "6", 10) || 6;
const MAX_AGE = parseInt(process.env.DOCS_MAX_AGE ?? "86400", 10) || 0;

// DOCS_ONLY="name1,name2" restricts the fetch to the named sources.
// Useful for verifying a single source (e.g. cloudflare-blog) without
// running the full ~30-min build. Unknown names are reported and ignored.
const onlyFilter = (process.env.DOCS_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let sources = SOURCES;
if (onlyFilter.length > 0) {
  const known = new Set(SOURCES.map((s) => s.name));
  const unknown = onlyFilter.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    console.warn(`DOCS_ONLY: ignoring unknown source(s): ${unknown.join(", ")}`);
  }
  const wanted = new Set(onlyFilter);
  sources = SOURCES.filter((s) => wanted.has(s.name));
  if (sources.length === 0) {
    console.error(`DOCS_ONLY matched no known sources: ${onlyFilter.join(", ")}`);
    process.exit(1);
  }
  console.log(`DOCS_ONLY active — fetching ${sources.length} source(s): ${sources.map((s) => s.name).join(", ")}`);
}

const update = new UpdateDocSets({
  sources,
  ingestors: [new GitIngestor(), new HttpIngestor()],
  normalisers: [new MdxNormaliser(), new HtmlNormaliser(), new GoNormaliser(), new MarkdownCleaner(), new ContentSanitiser()],
  outDir: OUT_DIR,
  workDir: WORK_DIR,
  concurrency: CONCURRENCY,
  maxAge: MAX_AGE,
});

const results = await update.run();

const successes = results.filter((r) => r.status === "ok");
const skipped = results.filter((r) => r.status === "skipped");
const errors = results.filter((r) => r.status === "error");

if (errors.length > 0) {
  console.warn(`\n${errors.length} source(s) failed:`);
  for (const e of errors) {
    console.warn(`  ${e.source}: ${e.error}`);
  }
}

if (successes.length === 0 && skipped.length === 0) {
  console.error("\nAll sources failed — aborting.");
  process.exit(1);
}

const parts = [`${successes.length} updated`];
if (skipped.length > 0) parts.push(`${skipped.length} cached`);
if (errors.length > 0) parts.push(`${errors.length} failed`);
console.log(`\n${results.length} sources: ${parts.join(", ")}.`);

// Write _source_groups.json for agents.sh. Same payload the standalone
// `commands/generate-source-groups.ts` produces — both use the shared
// pure builder so they never drift.
const sourceNames = new Set(SOURCES.map((s) => s.name));
const groupsPayload = buildSourceGroupsPayload(sourceNames);
const groupsPath = path.join(OUT_DIR, "_source_groups.json");
await fs.writeFile(groupsPath, JSON.stringify(groupsPayload, null, 2) + "\n");
console.log(`Generated ${groupsPath} (${Object.keys(groupsPayload).length} groups)`);

// Validate: warn about untagged sources (parity with the standalone CLI).
const untagged = SOURCES.filter((s) => !SOURCE_TAGS[s.name]).map((s) => s.name);
if (untagged.length) {
  console.warn(`\nWARNING: ${untagged.length} untagged sources: ${untagged.join(", ")}`);
}

// Exit explicitly. Node 22 warns and exits with 13 if a top-level await
// remains unsettled when the event loop drains — we've observed this in
// CI when a stray fetch handle outlives its source (the per-source
// deadline now catches the common case, but exit insulates against
// anything else). A clean exit also propagates success/failure to the
// shell based on how many sources actually produced output.
process.exit(errors.length > 0 && successes.length === 0 ? 1 : 0);
