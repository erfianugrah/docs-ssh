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

const update = new UpdateDocSets({
  sources: SOURCES,
  ingestors: [new GitIngestor(), new HttpIngestor()],
  normalisers: [new MdxNormaliser(), new HtmlNormaliser(), new MarkdownCleaner(), new ContentSanitiser()],
  outDir: OUT_DIR,
  workDir: WORK_DIR,
});

const results = await update.run();

const successes = results.filter((r) => r.status === "ok");
const errors = results.filter((r) => r.status === "error");

if (errors.length > 0) {
  console.warn(`\n${errors.length} source(s) failed:`);
  for (const e of errors) {
    console.warn(`  ${e.source}: ${e.error}`);
  }
}

if (successes.length === 0) {
  console.error("\nAll sources failed — aborting.");
  process.exit(1);
}

console.log(`\n${successes.length}/${results.length} sources updated successfully.`);
