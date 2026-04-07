import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Normalises MDX files to clean Markdown by:
 * - Stripping YAML frontmatter
 * - Removing import/export statements
 * - Removing JSX component tags (keeping their text content where possible)
 * - Renaming .mdx → .md
 */
export class MdxNormaliser implements DocNormaliser {
  readonly name = "MdxNormaliser";

  supports(file: DocFile): boolean {
    return file.extension === "mdx";
  }

  supportsFormat(format: DocFormat): boolean {
    return format === "mdx";
  }

  async normalise(file: DocFile): Promise<DocFile> {
    let content = file.content;

    // Strip YAML frontmatter
    content = content.replace(/^---[\s\S]*?---\n?/m, "");

    // Strip import statements (single and multi-line)
    content = content.replace(/^import\s+.*?(?:\n|$)/gm, "");

    // Strip export statements
    content = content.replace(/^export\s+.*?(?:\n|$)/gm, "");

    // Strip self-closing JSX tags <Component ... />
    content = content.replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, "");

    // Strip JSX open/close tags but keep inner text
    content = content.replace(/<[A-Z][A-Za-z]*[^>]*>([\s\S]*?)<\/[A-Z][A-Za-z]*>/g, "$1");

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    const newPath = file.path.replace(/\.mdx$/, ".md");
    return file.withContent(content).withPath(newPath);
  }
}
