import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Cleans up markdown files that have common boilerplate from doc sites.
 * Runs on ALL .md files (pass 3 cleanup normaliser).
 *
 * Strips:
 * - "[Skip to content]" links
 * - "Was this helpful? YesNo" prompts
 * - "Edit page" / "Report issue" / "Copy page" links
 * - JSON-LD breadcrumb blocks
 * - Inline CSS blocks that leaked through HTML conversion
 * - MediaWiki navigation chrome
 * - Common site-specific boilerplate
 * - Excessive blank lines
 */
export class MarkdownCleaner implements DocNormaliser {
  readonly name = "MarkdownCleaner";

  supports(file: DocFile): boolean {
    return file.extension === "md";
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

    // Remove inline CSS blocks that leaked through HTML→MD conversion
    // Matches lines like ".class { property: value; }" or "#id:hover {"
    content = content.replace(/^[.#@][\w-]+[^{]*\{[^}]*\}\s*$/gm, "");
    // Multi-line CSS blocks: selector { ... }
    content = content.replace(/^[.#@][\w-][^{]*\{\s*\n(?:[^}]*\n)*?\}\s*$/gm, "");

    // Remove MediaWiki navigation chrome
    content = content.replace(
      /^(?:Navigation menu|Page actions?|Personal tools|Jump to navigation|Jump to search|Views|Search|Toolbox|In other languages)\s*$/gm,
      "",
    );
    // MediaWiki footer boilerplate
    content = content.replace(/^Retrieved from "\[?https?:\/\/wiki\.[^"]*"?\]?\s*$/gm, "");

    // Remove common doc site boilerplate suffixes
    content = content.replace(/ - PostgreSQL wiki\s*$/gm, "");
    content = content.replace(/\| Docker Docs\s*$/gm, "");
    content = content.replace(/^Submit correction\s*$/gm, "");
    content = content.replace(
      /^If you see anything in the documentation that is not correct[\s\S]*?documentation issue\.\s*$/gm,
      "",
    );

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    return file.withContent(content);
  }
}
