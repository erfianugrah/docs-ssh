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

    // Extract title from frontmatter before stripping it — preserve as H1
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let fmTitle = "";
    if (fmMatch) {
      const titleMatch = fmMatch[1].match(/^title:\s*["']?([^"'\n]+)["']?\s*$/m);
      if (titleMatch) fmTitle = titleMatch[1].trim();
    }

    // Strip YAML frontmatter (no `m` flag — `^` must match start of string,
    // not start of any line, to avoid stripping content between --- HRs)
    content = content.replace(/^---[\s\S]*?---\n?/, "");

    // Inject frontmatter title as H1 if content doesn't already start with one
    if (fmTitle && !content.trimStart().startsWith("# ")) {
      content = `# ${fmTitle}\n\n${content}`;
    }

    // Strip import statements (single-line and multi-line with braces)
    content = content.replace(/^import\s+\{[^}]*\}\s+from\s+[^\n]+(?:\n|$)/gm, "");
    content = content.replace(/^import\s+.*?(?:\n|$)/gm, "");

    // Strip export statements (single-line and multi-line default/named)
    content = content.replace(/^export\s+default\s+function[^{]*\{[\s\S]*?^\}/gm, "");
    content = content.replace(/^export\s+.*?(?:\n|$)/gm, "");

    // Strip JSX component tags. We treat opening, closing, and
    // self-closing tags independently rather than trying to pair
    // <Tag>...</Tag> with a non-greedy regex — that approach fails on
    // nested components (e.g. Astro Starlight's <Tabs><TabItem>...
    // </TabItem></Tabs>), leaving orphan opening tags in the output.
    // The component's inner text is plain markdown / code, so dropping
    // the tags wholesale produces clean output.
    content = content.replace(/<[A-Z][A-Za-z0-9]*[^>]*\/>/g, "");
    content = content.replace(/<[A-Z][A-Za-z0-9]*[^>]*>/g, "");
    content = content.replace(/<\/[A-Z][A-Za-z0-9]*>/g, "");

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    const newPath = file.path.replace(/\.mdx$/, ".md");
    return file.withContent(content).withPath(newPath);
  }
}
