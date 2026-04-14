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
