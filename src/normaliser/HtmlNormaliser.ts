import TurndownService from "turndown";
import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat, DocSource } from "../domain/DocSource.js";

/**
 * Minimum output-to-input ratio to accept the conversion.
 * If the markdown output is less than 1% of the HTML input size,
 * the page is likely an RSC/SPA shell with no extractable content -
 * the page is dropped from the doc set (returning null).
 */
const MIN_CONVERSION_RATIO = 0.01;

/**
 * Minimum plausible size (chars) of a converted doc page. Used as an
 * absolute floor alongside MIN_CONVERSION_RATIO: pages with extreme
 * boilerplate overhead (e.g. docs.redhat.com ships ~780KB of PatternFly
 * markup for ~3.5KB of chapter prose) fail any pure ratio test despite
 * converting perfectly, and fragments below ~1KB can't be a real doc
 * page anyway.
 */
const MIN_CONTENT_SIZE = 1024;

/**
 * Converts HTML files to Markdown using Turndown.
 * Strips nav, header, footer, script and style elements before converting.
 * Falls back to original content if conversion produces too little output
 * (e.g. RSC-rendered pages where content is in script payloads).
 */
export class HtmlNormaliser implements DocNormaliser {
  readonly name = "HtmlNormaliser";
  private readonly td: TurndownService;

  constructor() {
    this.td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    // Drop noisy elements via Turndown's own HTML parser so we don't
    // have to regex-strip them upstream. Handles edge cases the
    // previous `<script[\s\S]*?</script>` regex got wrong (e.g. JS
    // source containing the literal string "</script>").
    // `title` listed separately: Turndown's inline HTML parser
    // doesn't always nest <title> under <head> when given fragmentary
    // input, so removing <head> alone leaks the page-title text as
    // a paragraph. Listing it directly catches both shapes.
    this.td.remove(["head", "title", "nav", "header", "footer", "script", "style"]);
  }

  supports(file: DocFile): boolean {
    return file.extension === "html";
  }

  supportsFormat(format: DocFormat): boolean {
    return format === "html";
  }

  async normalise(file: DocFile, source?: DocSource): Promise<DocFile | null> {
    let html = file.content;
    const originalSize = html.length;

    // Extract <title> before Turndown strips <head> — used as H1 fallback
    // when the rendered markdown doesn't start with one. Site suffixes
    // like "Page | Site", "Page — Site", "Page - Site" stripped (the
    // hyphen pattern requires surrounding spaces to keep "Self-hosted").
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const htmlTitle = decodeEntities(
      titleMatch?.[1]?.trim().replace(/\s*(?:\||–|—)\s.*$/, "").replace(/\s+-\s+.*$/, "") ?? "",
    );

    // Content-selection cascade: <article> first, then <main>, then
    // the full document. This is a *selection*, not a removal -
    // Turndown has no native equivalent - so it stays as regex. Noise
    // elements (head, nav, header, footer, script, style) are dropped
    // by the constructor's td.remove() via Turndown's real HTML parser.
    //
    // <article> wins over <main> because some themes wrap sidebar+
    // content in <main> but the prose in <article> (DokuWiki's
    // bootstrap3 on openwrt.org: <main> is 100+ lines of nav junk).
    // Each step is only taken when the previous converted thin
    // (<MIN_CONTENT_SIZE): the first <article> on some themes is a
    // comment block (WordPress) or teaser card, not the post body.
    // Only swap when the next candidate converts larger - on
    // well-structured pages the first selection is the clean one and
    // the wider candidates just add nav junk.
    // A source-declared content class (htmlContentClass) wins outright.
    const classSelection = source?.htmlContentClass
      ? extractByClass(html, source.htmlContentClass)
      : undefined;
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const selections = (
      classSelection !== undefined ? [classSelection] : [articleMatch?.[1], mainMatch?.[1]]
    ).filter((s): s is string => s !== undefined);
    let markdown = "";
    for (const candidate of selections) {
      const converted = this.td.turndown(candidate).trim();
      if (converted.length > markdown.length) markdown = converted;
      if (markdown.length >= MIN_CONTENT_SIZE) break;
    }
    // Widen to the full document only when a selection converted thin
    // AND the page is big enough that the thinness means "wrong
    // fragment" rather than "genuinely small page" - on a small page
    // the selection IS the page and widening just adds chrome.
    if (
      classSelection === undefined &&
      (selections.length === 0 || (originalSize > 1000 && markdown.length < MIN_CONTENT_SIZE))
    ) {
      const fullPage = this.td.turndown(html).trim();
      if (fullPage.length > markdown.length) markdown = fullPage;
    }

    // Inject HTML <title> as H1 if markdown doesn't already have one
    if (htmlTitle && !markdown.startsWith("# ")) {
      markdown = `# ${htmlTitle}\n\n${markdown}`;
    }

    // Empty-conversion guard: if conversion produced almost nothing from
    // a large input (both absolutely and relative to the page), the page
    // is an RSC/SPA app shell with no doc value (e.g. a paginated listing
    // page). Drop it from the doc set rather than keeping raw HTML - a
    // .html file in the corpus breaks the downstream invariant that
    // markdown-capable sources contain only .md files (enforced by the
    // post-deploy smoke test).
    // A matched htmlContentClass element is the page's own content, so a
    // short result is a short page, not an app shell.
    if (
      classSelection === undefined &&
      originalSize > 1000 &&
      markdown.length < MIN_CONTENT_SIZE &&
      markdown.length < originalSize * MIN_CONVERSION_RATIO
    ) {
      return null;
    }

    const newPath = file.path.replace(/\.html$/, ".md");
    return file.withContent(markdown).withPath(newPath);
  }
}

/**
 * Inner HTML of the first element whose class list contains `cls` as a
 * whole token, or undefined. Balances same-tag open/close pairs from the
 * match (regex, like the article/main selection above: one known class
 * on one known upstream, not a general selector engine).
 */
export function extractByClass(html: string, cls: string): string | undefined {
  const esc = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const open = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bclass="(?:[^"]*\\s)?${esc}(?:\\s[^"]*)?"[^>]*>`, "i");
  const m = open.exec(html);
  if (!m) return undefined;
  const tag = m[1].toLowerCase();
  const start = m.index + m[0].length;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 1;
  for (let t = re.exec(html); t; t = re.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return html.slice(start);
}

/** The handful of entities that show up in <title> text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
