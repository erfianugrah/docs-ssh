import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import TurndownService from "turndown";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gfm } = require("turndown-plugin-gfm") as {
  gfm: TurndownService.Plugin;
};

const RST_RENDERER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "rst-render.py",
);

export interface ConvertedFile {
  path: string;
  content: string;
}

/**
 * Batch-converts a tree of reStructuredText (.rst) files to markdown.
 *
 * Why in the ingestor layer (not a DocNormaliser): like
 * asciidoc-converter.ts, RST conversion benefits from processing all
 * pages in one Python process - docutils imports incur a ~200ms cold
 * cost, and batching amortizes that to near-zero per file.
 *
 * Pipeline per batch:
 *   1. Collect all .rst files under `rstDir`.
 *   2. Pass them as JSON to rst-render.py (Python + docutils):
 *      RST → HTML5 via docutils.core.publish_parts, with Sphinx
 *      directive/role stubs registered so pages render instead of
 *      erroring.
 *   3. Turndown converts each HTML5 fragment → markdown.
 *   4. Post-process: extract H1 from the doc title section (docutils
 *      renders the `=======` / `-------` adorned title as an <h1>
 *      with class="title"), rewrite relative :doc: / `.rst` links
 *      to `.md`, drop class/docutils attributes.
 *
 * `rstDir` is the directory containing the .rst files (e.g. the
 * sparse-checked-out doc tree root). Output paths are relative to
 * `rstDir` with `.rst` → `.md`.
 */
export async function convertRstTree(rstDir: string): Promise<ConvertedFile[]> {
  if (!fs.existsSync(rstDir)) {
    throw new Error(`rst-converter: directory not found: ${rstDir}`);
  }

  // Collect all .rst files
  const rstFiles = walkRst(rstDir);
  if (rstFiles.length === 0) {
    throw new Error(`rst-converter: no .rst files found under ${rstDir}`);
  }

  // Build payload: [[relPath, content], ...]
  const payload: [string, string][] = [];
  for (const absPath of rstFiles) {
    const relPath = path.relative(rstDir, absPath);
    const content = fs.readFileSync(absPath, "utf-8");
    payload.push([relPath, content]);
  }

  // Batch-render via Python/docutils
  const htmlResults = renderBatch(payload);
  if (!htmlResults) {
    throw new Error("rst-converter: rst-render.py failed (missing python3 or docutils)");
  }

  // HTML5 → markdown via Turndown
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);

  const out: ConvertedFile[] = [];
  for (const [relPath, html5] of htmlResults) {
    if (!html5.trim()) continue;

    try {
      let md = td.turndown(html5);

      // Post-process: rewrite :doc: stubs and explicit .rst links → .md
      md = rewriteRstLinks(md);

      // Turndown escapes backticks, brackets and underscores in stub
      // text. Unescape them so stubs read cleanly.
      // Pattern 1: role stubs with backtick-wrapped text
      //   \[role: \`text\`\] -> [role: \`text\`]
      md = md.replace(
        /\\?\[([a-z_]+):\s*\\`([^`]+)\\`\\?\]/g,
        (_m, role: string, text: string) => {
          const clean = text.replace(/\\_/g, "_");
          return `[${role}: \`${clean}\`]`;
        },
      );
      // Pattern 2: directive stubs with plain text
      //   \[directive: name\] -> [directive: name]
      md = md.replace(
        /\\?\[directive:\s*([^\]\\]+)\\?\]/g,
        (_m, name: string) => `[directive: ${name.trim()}]`,
      );

      // Strip Sphinx :orphan: field (docutils renders as "orphan:" text)
      md = md.replace(/^orphan:\s*\n+/gm, "");

      // Strip empty class/docutils noise lines Turndown sometimes leaves
      md = md.replace(/\n\{\}\n/g, "\n");
      // Strip docutils class/docinfo/ids from heading and paragraph lines
      md = md.replace(/\{[.#][^}]*\}\s*/g, "");
      md = md.trim();

      if (md.trim()) {
        const outPath = relPath.replace(/\.rst$/, ".md");
        out.push({ path: outPath, content: md });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [rst] failed to convert ${relPath}: ${msg}`);
    }
  }

  console.log(`  [rst] converted ${out.length}/${rstFiles.length} files`);
  return out;
}

// ── Walk .rst files ──────────────────────────────────────────────────

function walkRst(dir: string): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".rst")) {
        results.push(full);
      }
    }
  }
  results.sort();
  return results;
}

// ── Python batch render ──────────────────────────────────────────────

const MAX_BATCH_BYTES = 8 * 1024 * 1024; // 8 MB per batch

function renderBatch(
  payloads: [string, string][],
): [string, string][] | null {
  if (!docutilsAvailable()) {
    console.warn("  [rst] python3+docutils unavailable - cannot render RST");
    return null;
  }

  // Split into batches by accumulated content size to avoid hitting
  // execFileSync's maxBuffer (256 MB, but large batches also risk OOM
  // in the Python process).
  const batches: [string, string][][] = [];
  let current: [string, string][] = [];
  let currentSize = 0;
  for (const p of payloads) {
    const size = Buffer.byteLength(p[1], "utf-8");
    if (currentSize + size > MAX_BATCH_BYTES && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(p);
    currentSize += size;
  }
  if (current.length > 0) batches.push(current);

  const allResults: [string, string][] = [];
  for (const batch of batches) {
    try {
      const stdout = execFileSync("python3", [RST_RENDERER], {
        input: JSON.stringify({ files: batch }),
        encoding: "utf-8",
        maxBuffer: 256 * 1024 * 1024,
      });
      const parsed: unknown = JSON.parse(stdout);
      if (!Array.isArray(parsed) || parsed.length !== batch.length) {
        throw new Error(
          `rst-render returned ${Array.isArray(parsed) ? parsed.length : "non-array"} results for ${batch.length} files`,
        );
      }
      // Each result is [relPath, html5]
      for (const entry of parsed as unknown[]) {
        const pair = entry as [string, string];
        allResults.push(pair);
      }
    } catch (err) {
      console.warn(
        `  [rst] rst-render batch failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
  return allResults;
}

function docutilsAvailable(): boolean {
  try {
    execFileSync("python3", ["-c", "import docutils"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Link rewriting ───────────────────────────────────────────────────

/**
 * Rewrite internal RST cross-references (produced by the docutils
 * stub for `:doc:` and explicit `.rst` links) from `.rst` → `.md`
 * so the link graph resolves them against the corpus.
 */
function rewriteRstLinks(md: string): string {
  // :doc:`path` stubs rendered as "[doc: `path`]" (plain) or
  // "\[doc: \`path\`]" (Turndown-escaped brackets+backticks).
  // Turn into a link to `<path>.md` when the path looks like a
  // relative document reference.
  md = md.replace(
    /\\?\[doc:\s*\\?`([^`]+)\\?`\\?\]/g,
    (_m, p: string) => {
      // Strip trailing backslash captured by [^`]+ - Turndown
      // inserts \` for escaped backticks, and "\``" is the
      // sequence "backslash + backtick".
      let cleaned = p.replace(/\\+$/, "").trim();
      // Sphinx :doc:`/path` is root-relative within the source -
      // strip the leading / to get the corpus path.
      if (cleaned.startsWith("/")) cleaned = cleaned.slice(1);
      if (/^(https?:)/.test(cleaned)) return _m;
      return `[${cleaned}](${cleaned}.md)`;
    },
  );

  // Explicit `.rst` link targets → `.md`. Turndown converts HTML <a>
  // to markdown links; docutils renders :doc:`foo` as <a href="foo.html">
  // if we didn't stub it. With the stub it's "[doc: `foo`]". But users
  // also write `.. _link: foo.rst` and `link`_ references which docutils
  // resolves to `<a href="foo.rst">`. We rewrite those here.
  md = md.replace(
    /\]\(([^)]+)\.md\.rst\)/g,
    (_m, p: string) => `](${p}.md)`,
  );

  return md;
}