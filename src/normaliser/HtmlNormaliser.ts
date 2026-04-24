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

    // Extract <title> before stripping — inject as H1 if Turndown misses it
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const htmlTitle = titleMatch?.[1]?.trim().replace(/\s*[|–—-]\s*.*$/, "") ?? "";

    // Strip elements that add noise for agents
    html = html.replace(/<head[\s\S]*?<\/head>/gi, "");
    html = html.replace(/<nav[\s\S]*?<\/nav>/gi, "");
    html = html.replace(/<header[\s\S]*?<\/header>/gi, "");
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, "");
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");

    // If there's a <main> or <article> element, use only its contents
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
