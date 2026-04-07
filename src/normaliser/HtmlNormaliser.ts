import TurndownService from "turndown";
import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";

/**
 * Converts HTML files to Markdown using Turndown.
 * Strips nav, header, footer and script elements before converting.
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

  async normalise(file: DocFile): Promise<DocFile> {
    let html = file.content;

    // Strip elements that add noise for agents
    html = html.replace(/<nav[\s\S]*?<\/nav>/gi, "");
    html = html.replace(/<header[\s\S]*?<\/header>/gi, "");
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, "");
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");

    // If there's a <main> element, use only its contents
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      html = mainMatch[1];
    }

    const markdown = this.td.turndown(html).trim();
    const newPath = file.path.replace(/\.html$/, ".md");
    return file.withContent(markdown).withPath(newPath);
  }
}
