/**
 * Trial fetch for the markdown content-negotiation work.
 *
 * Fetches a small subset of sources through the real pipeline,
 * targeting /tmp so it does not collide with the build's ./docs
 * cache. Reports per-source file counts, total bytes, and a sample
 * of pre-normalised vs HTML-converted output for spot-checking.
 *
 * Run: pnpm tsx scripts/trial-accept-markdown.ts
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GitIngestor } from "../src/ingestors/GitIngestor.js";
import { HttpIngestor } from "../src/ingestors/HttpIngestor.js";
import { MdxNormaliser } from "../src/normaliser/MdxNormaliser.js";
import { HtmlNormaliser } from "../src/normaliser/HtmlNormaliser.js";
import { MarkdownCleaner } from "../src/normaliser/MarkdownCleaner.js";
import { ContentSanitiser } from "../src/normaliser/ContentSanitiser.js";
import { UpdateDocSets } from "../src/application/UpdateDocSets.js";
import { SOURCES } from "../src/application/sources.js";

// Wider subset for regression hunting:
//   - all 9 verified markdown-capable sources
//   - 2 HTML-only controls
const NAMES = new Set([
  "cloudflare",
  "cloudflare-blog",
  "cloudflare-changelog",
  "vercel-blog",
  "turborepo",
  "prisma",
  "resend",
  "ansible",
  "patroni",
  "modern-sql",
  "use-the-index-luke",
]);

const subset = SOURCES.filter((s) => NAMES.has(s.name));
if (subset.length !== NAMES.size) {
  const missing = [...NAMES].filter((n) => !subset.find((s) => s.name === n));
  console.error("Missing sources:", missing.join(", "));
  process.exit(1);
}

const outDir = path.join(os.tmpdir(), "docs-ssh-trial-cn");
const workDir = path.join(os.tmpdir(), "docs-ssh-trial-cn-work");
await fs.rm(outDir, { recursive: true, force: true });
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(workDir, { recursive: true });

console.log(`[trial] outDir: ${outDir}`);
console.log(`[trial] sources: ${[...NAMES].join(", ")}\n`);

const t0 = Date.now();
const update = new UpdateDocSets({
  sources: subset,
  ingestors: [new GitIngestor(), new HttpIngestor()],
  normalisers: [
    new MdxNormaliser(),
    new HtmlNormaliser(),
    new MarkdownCleaner(),
    new ContentSanitiser(),
  ],
  outDir,
  workDir,
  concurrency: 5,
  maxAge: 0, // force fresh fetch
});

const results = await update.run();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n[trial] completed in ${elapsed}s\n`);

// Per-source report
console.log("source                file_count   total_kb   sample_first_lines");
console.log("─".repeat(120));
for (const name of NAMES) {
  const dir = path.join(outDir, name);
  let count = 0;
  let bytes = 0;
  let samplePath = "";
  try {
    const walk = async (d: string): Promise<void> => {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          await walk(p);
        } else {
          const stat = await fs.stat(p);
          bytes += stat.size;
          count++;
          if (!samplePath && stat.size > 500) samplePath = p;
        }
      }
    };
    await walk(dir);
  } catch {
    // Source failed
  }
  const sample = samplePath
    ? (await fs.readFile(samplePath, "utf-8"))
        .split("\n")
        .slice(0, 3)
        .join(" | ")
        .slice(0, 60)
    : "(no output)";
  console.log(
    `${name.padEnd(22)}${String(count).padStart(10)}${String(Math.round(bytes / 1024)).padStart(11)}   ${sample}`,
  );
}

console.log("\n[trial] result statuses:");
for (const r of results) {
  const detail =
    r.status === "ok"
      ? `+${r.diff?.added ?? 0} ~${r.diff?.modified ?? 0} -${r.diff?.removed ?? 0}`
      : r.status === "error"
        ? r.error
        : "";
  console.log(`  ${r.source.padEnd(22)} ${r.status.padEnd(8)} ${detail}`);
}

console.log(`\n[trial] outDir preserved at ${outDir} for manual inspection`);
process.exit(0);
