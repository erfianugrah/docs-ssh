import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Cleans up markdown files that have common boilerplate from doc sites.
 * Applied to markdown content from llms-full.txt or similar sources.
 *
 * Strips:
 * - "[Skip to content]" links
 * - "Was this helpful? YesNo" prompts
 * - "Edit page" / "Report issue" / "Copy page" links
 * - JSON-LD breadcrumb blocks
 * - Excessive blank lines
 */
export class MarkdownCleaner implements DocNormaliser {
  readonly name = "MarkdownCleaner";

  supports(file: DocFile): boolean {
    // Only apply to .md files that contain known boilerplate patterns
    return file.extension === "md" && file.content.includes("[Skip to content]");
  }

  supportsFormat(_format: DocFormat): boolean {
    return false;
  }

  async normalise(file: DocFile): Promise<DocFile> {
    let content = file.content;

    // Remove "[Skip to content](...)" link
    content = content.replace(/\[Skip to content\]\([^)]*\)\s*/g, "");

    // Remove "Was this helpful?" block
    content = content.replace(/Was this helpful\?\s*\n*YesNo\s*/g, "");

    // Remove "Edit page" / "Report issue" / "Copy page" links
    content = content.replace(
      /\[\s*(?:Edit page|Report issue|Copy page)\s*\]\s*\([^)]*\)\s*/g,
      "",
    );

    // Remove standalone "Copy page" text
    content = content.replace(/^Copy page\s*$/gm, "");

    // Remove JSON-LD breadcrumb blocks (```json ... schema.org/BreadcrumbList ... ```)
    content = content.replace(
      /```json\s*\n\s*\{[^`]*"@type"\s*:\s*"BreadcrumbList"[^`]*\}\s*\n\s*```/g,
      "",
    );

    // Remove standalone JSON-LD without code fence
    content = content.replace(
      /^\{[^}]*"@type"\s*:\s*"BreadcrumbList"[^}]*\}\s*$/gm,
      "",
    );

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    return file.withContent(content);
  }
}
