import TurndownService from "turndown";
import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

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

  async normalise(file: DocFile): Promise<DocFile | null> {
    let html = file.content;
    const originalSize = html.length;

    // Extract <title> before Turndown strips <head> — used as H1 fallback
    // when the rendered markdown doesn't start with one. Site suffixes
    // like "Page | Site", "Page — Site", "Page - Site" stripped (the
    // hyphen pattern requires surrounding spaces to keep "Self-hosted").
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const htmlTitle = titleMatch?.[1]?.trim().replace(/\s*(?:\||–|—)\s.*$/, "").replace(/\s+-\s+.*$/, "") ?? "";

    // If there's a <main> or <article> element, use only its contents.
    // This is a *selection*, not a removal — Turndown has no native
    // equivalent — so it stays as regex. Noise elements (head, nav,
    // header, footer, script, style) are dropped by the constructor's
    // td.remove() registration via Turndown's real HTML parser.
    const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
    const selected = mainMatch ? mainMatch[1] : html;

    let markdown = this.td.turndown(selected).trim();

    // The non-greedy selection regex grabs the FIRST <main|article>,
    // which on some themes is not the post body (e.g. WordPress pages
    // where the first <article> is a comment block and the content
    // lives in plain <div>s). If the selected fragment is too small to
    // be a real doc page, retry against the full document before
    // concluding the page is an SPA shell. Only swap when the full-page
    // conversion is larger - on well-structured pages the selection is
    // the clean one and the full page just adds nav junk.
    if (mainMatch && originalSize > 1000 && markdown.length < MIN_CONTENT_SIZE) {
      const fullPage = this.td.turndown(html).trim();
      if (fullPage.length > markdown.length) {
        markdown = fullPage;
      }
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
    if (
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
