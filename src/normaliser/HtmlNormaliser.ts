import TurndownService from "turndown";
import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Minimum output-to-input ratio to accept the conversion.
 * If the markdown output is less than 1% of the HTML input size,
 * the page is likely an RSC/SPA shell with no extractable content —
 * keep the original to avoid silent data loss.
 */
const MIN_CONVERSION_RATIO = 0.01;

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

  async normalise(file: DocFile): Promise<DocFile> {
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
    if (mainMatch) {
      html = mainMatch[1];
    }

    let markdown = this.td.turndown(html).trim();

    // Inject HTML <title> as H1 if markdown doesn't already have one
    if (htmlTitle && !markdown.startsWith("# ")) {
      markdown = `# ${htmlTitle}\n\n${markdown}`;
    }

    // Safety guard: if conversion produced almost nothing from a large input,
    // the page is likely RSC/SPA rendered. Keep original to avoid data loss.
    if (originalSize > 1000 && markdown.length < originalSize * MIN_CONVERSION_RATIO) {
      return file;
    }

    const newPath = file.path.replace(/\.html$/, ".md");
    return file.withContent(markdown).withPath(newPath);
  }
}
