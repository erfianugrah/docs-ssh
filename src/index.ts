import * as os from "node:os";
import * as path from "node:path";
import { GitIngestor } from "./ingestors/GitIngestor.js";
import { HttpIngestor } from "./ingestors/HttpIngestor.js";
import { MdxNormaliser } from "./normaliser/MdxNormaliser.js";
import { HtmlNormaliser } from "./normaliser/HtmlNormaliser.js";
import { MarkdownCleaner } from "./normaliser/MarkdownCleaner.js";
import { ContentSanitiser } from "./normaliser/ContentSanitiser.js";
import { UpdateDocSets } from "./application/UpdateDocSets.js";
import { SOURCES } from "./application/sources.js";

const OUT_DIR = process.env.DOCS_OUT_DIR ?? path.join(process.cwd(), "docs");
const WORK_DIR = process.env.DOCS_WORK_DIR ?? path.join(os.tmpdir(), "docs-ssh-work");
const CONCURRENCY = parseInt(process.env.DOCS_CONCURRENCY ?? "6", 10) || 6;
const MAX_AGE = parseInt(process.env.DOCS_MAX_AGE ?? "86400", 10) || 0;

const update = new UpdateDocSets({
  sources: SOURCES,
  ingestors: [new GitIngestor(), new HttpIngestor()],
  normalisers: [new MdxNormaliser(), new HtmlNormaliser(), new MarkdownCleaner(), new ContentSanitiser()],
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

// Generate source groups JSON for agents.sh
import { SOURCE_TAGS, TAG_LABELS, buildSourceGroups } from "./application/source-tags.js";
const groups = buildSourceGroups();
const sourceNames = new Set(SOURCES.map((s) => s.name));
const groupsOutput: Record<string, { label: string; sources: string[] }> = {};
for (const [tag, names] of groups) {
  const existing = names.filter((n) => sourceNames.has(n));
  if (existing.length) {
    groupsOutput[tag] = { label: TAG_LABELS[tag] ?? tag, sources: existing };
  }
}
const groupsPath = path.join(OUT_DIR, "_source_groups.json");
await import("node:fs/promises").then((fs) =>
  fs.writeFile(groupsPath, JSON.stringify(groupsOutput, null, 2) + "\n"),
);
console.log(`Generated ${groupsPath} (${Object.keys(groupsOutput).length} groups)`);

// Validate: warn about untagged sources
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
