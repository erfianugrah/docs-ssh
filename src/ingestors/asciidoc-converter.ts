import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { load as parseYaml } from "js-yaml";
import TurndownService from "turndown";

// @asciidoctor/core and turndown-plugin-gfm are CommonJS with non-default
// export shapes that don't destructure cleanly under NodeNext ESM. Load
// them through createRequire so the interop is explicit and stable.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const asciidoctor = require("@asciidoctor/core") as {
  loadFile: (file: string, opts: Record<string, unknown>) => Promise<AdocDocument>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { gfm } = require("turndown-plugin-gfm") as {
  gfm: TurndownService.Plugin;
};

interface AdocDocument {
  getDocumentTitle: (opts?: Record<string, unknown>) => string | undefined;
  convert: () => string | Promise<string>;
}

export interface ConvertedFile {
  path: string;
  content: string;
}

/**
 * Converts an Antora-flavoured AsciiDoc documentation tree (e.g.
 * Debezium's `documentation/` component) into per-page markdown.
 *
 * Why this lives in the ingestor layer rather than as a DocNormaliser:
 * AsciiDoc `include::` directives pull content from sibling partials and
 * snippets, so conversion needs the whole checkout on disk — a per-file
 * normaliser (which only sees one DocFile's content) can't resolve them.
 * This mirrors `openapi-converter.ts`, which is likewise a structural
 * transform invoked from the ingestor.
 *
 * Pipeline per page:
 *   1. Asciidoctor (pure-JS, no Ruby) renders `.adoc` → HTML, resolving
 *      `include::`, `ifdef::community/product[]`, attributes, and `xref:`
 *      against the on-disk module using the antora.yml attribute set.
 *   2. Turndown (+ GFM tables) converts HTML → markdown.
 *   3. Cleanup: strip Asciidoctor's visible "Unresolved directive"
 *      placeholders (build-time-generated snippets Debezium never commits
 *      to git), rewrite leaked absolute image paths to basenames, and
 *      rewrite `xref` `.html` targets to `.md`.
 *
 * `componentRoot` is the directory containing `antora.yml` (the Antora
 * component root, e.g. `<clone>/documentation`).
 */
export async function convertAsciiDocTree(componentRoot: string): Promise<ConvertedFile[]> {
  const moduleRoot = path.join(componentRoot, "modules", "ROOT");
  const pagesDir = path.join(moduleRoot, "pages");
  if (!fs.existsSync(pagesDir)) {
    throw new Error(`asciidoc-converter: pages dir not found: ${pagesDir}`);
  }

  const attributes = buildAttributes(componentRoot, moduleRoot);
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);

  const out: ConvertedFile[] = [];
  for (const absPath of walkAdoc(pagesDir)) {
    const rel = path.relative(pagesDir, absPath);
    const outPath = rel.replace(/\.adoc$/, ".md");
    try {
      const md = await convertOne(absPath, moduleRoot, attributes, td);
      if (md.trim()) out.push({ path: outPath, content: md });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [asciidoc] failed to convert ${rel}: ${msg}`);
    }
  }
  return out;
}

/** Render and clean a single `.adoc` page. */
async function convertOne(
  absPath: string,
  moduleRoot: string,
  attributes: Record<string, unknown>,
  td: TurndownService,
): Promise<string> {
  // Merge the page's own header attribute definitions (`:connector-name:
  // MySQL`, `:context: mysql`, …) into the API attribute map. Passing
  // them via the API makes them resolve inside included partials too —
  // shared partials reference `{connector-name}` but don't see the
  // including page's header scope otherwise, leaking the literal token.
  const pageAttrs = parsePageHeaderAttributes(fs.readFileSync(absPath, "utf-8"));
  const doc = await asciidoctor.loadFile(absPath, {
    safe: "unsafe", // allow include:: resolution from the filesystem
    base_dir: moduleRoot,
    standalone: false, // body only — the title is prepended separately
    attributes: { ...attributes, ...pageAttrs },
  });
  const title = doc.getDocumentTitle()?.trim();
  const html = await doc.convert();
  let md = td.turndown(html).trim();
  md = cleanMarkdown(md);

  // standalone:false omits the document title from the body — prepend it
  // as an H1 so the page has a heading for the search indexer.
  if (title && !/^#\s/.test(md)) {
    md = `# ${stripInlineFormatting(title)}\n\n${md}`;
  }
  return md ? md + "\n" : "";
}

/** Strip the leaked rendering artifacts described in the module header. */
function cleanMarkdown(md: string): string {
  const lines = md.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    // Asciidoctor emits "Unresolved directive in <file> - include::..."
    // as visible text when an include target is missing (Debezium's
    // build-generated config-property snippets are not in git). Drop it.
    if (/Unresolved directive in .+? - include::/.test(line)) continue;
    kept.push(line);
  }
  let s = kept.join("\n");

  // Asciidoctor renders section headings with an empty self-anchor
  // (`<a class="anchor" href="#_x"></a>`) which Turndown emits as a
  // zero-text link `[](#_x)`. Drop these — they're navigation chrome.
  s = s.replace(/\[\]\(#[^)]*\)/g, "");

  // Leaked absolute image paths → basename (images aren't served, but a
  // readable filename beats an absolute build-host path).
  s = s.replace(
    /!\[([^\]]*)\]\((?:[^)]*\/)?([^/)]+\.(?:png|jpe?g|gif|svg))\)/gi,
    (_m, alt: string, file: string) => `![${alt}](${file})`,
  );

  // Relative xref targets render as `.html`; the served files are `.md`.
  // Only rewrite links that are not absolute URLs.
  s = s.replace(
    /\]\((?!https?:)([^)]+?)\.html(#[^)]*)?\)/gi,
    (_m, base: string, frag: string = "") => `](${base}.md${frag})`,
  );

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Asciidoctor titles can carry inline markup; flatten to plain text. */
function stripInlineFormatting(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/**
 * Build the Asciidoctor attribute map: the antora.yml component
 * attributes plus the Antora intrinsics (absolute partials/images/
 * snippets dirs so `include::{partialsdir}/...` resolves) and the few
 * playbook-level attributes the component assumes are set.
 */
function buildAttributes(
  componentRoot: string,
  moduleRoot: string,
): Record<string, unknown> {
  let antoraAttrs: Record<string, unknown> = {};
  const antoraPath = path.join(componentRoot, "antora.yml");
  if (fs.existsSync(antoraPath)) {
    const parsed = parseYaml(fs.readFileSync(antoraPath, "utf-8")) as {
      asciidoc?: { attributes?: Record<string, unknown> };
    };
    antoraAttrs = parsed?.asciidoc?.attributes ?? {};
  }

  return {
    ...antoraAttrs,
    // Product naming (defined in the Antora playbook upstream, not the
    // component descriptor) — without these every page leaks {prodname}.
    prodname: "Debezium",
    "prodname-alt": "Debezium",
    // Render the community variant of `ifdef::community/product[]`.
    community: "",
    product: false,
    // Absolute include roots so `{partialsdir}`/`{snippetsdir}` resolve.
    // snippetsdir intentionally points at a dir that doesn't exist —
    // those snippets are build-generated and absent from git; the
    // resulting "Unresolved directive" lines are stripped in cleanup.
    partialsdir: path.join(moduleRoot, "partials"),
    imagesdir: path.join(moduleRoot, "assets", "images"),
    snippetsdir: path.join(moduleRoot, "snippets"),
    "link-kafka-docs": "https://kafka.apache.org/documentation",
  };
}

/**
 * Extract a page's leading header attribute definitions. AsciiDoc
 * attribute entries look like `:name: value` (or `:name:` /  `:!name:`
 * for boolean set/unset). Only the contiguous header block is scanned
 * — from the document title (`= …`) until the first blank line that
 * precedes body content — so body-level `:attr:` reassignments (rare)
 * and the inside of `ifdef::[]` blocks don't pollute the global map.
 */
function parsePageHeaderAttributes(source: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const lines = source.split(/\r?\n/);
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!started) {
      // Skip leading comments/blank lines until the document title.
      if (/^=\s+\S/.test(line)) started = true;
      continue;
    }
    // Header ends at the first blank line followed by non-attribute body.
    if (line.trim() === "") {
      const next = lines[i + 1] ?? "";
      if (!/^[:\/]/.test(next) && !/^ifdef::|^ifndef::|^endif::/.test(next)) break;
      continue;
    }
    const set = line.match(/^:([a-zA-Z][\w-]*):\s+(.+)$/);
    if (set) {
      attrs[set[1]] = set[2].trim();
      continue;
    }
    const boolSet = line.match(/^:([a-zA-Z][\w-]*):\s*$/);
    if (boolSet) {
      attrs[boolSet[1]] = "";
      continue;
    }
    const unset = line.match(/^:!([a-zA-Z][\w-]*):\s*$/);
    if (unset) {
      attrs[unset[1]] = false;
      continue;
    }
    // Conditional directives and comments are allowed within the header;
    // anything else (a section heading, prose, an include) ends it.
    if (/^(\/\/|ifdef::|ifndef::|endif::|\[)/.test(line)) continue;
    break;
  }
  return attrs;
}

/** Recursively collect `.adoc` files under a directory. */
function walkAdoc(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkAdoc(full));
    } else if (entry.isFile() && entry.name.endsWith(".adoc")) {
      result.push(full);
    }
  }
  return result;
}
