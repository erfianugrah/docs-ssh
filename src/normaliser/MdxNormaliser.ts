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

    // Strip export statements (multi-line then single-line — order matters).
    //
    // Order rationale: the single-line regex `^export\s+.*?(?:\n|$)` is
    // greedy enough to match the first line of `export const meta = {`
    // and stop at the newline, leaving the object literal stranded as
    // garbage in the output. Tailwind blog MDX files exposed this on
    // ~16 prod pages where the literal's `title: "..."` leaked into
    // index summaries. So strip the multi-line forms first.
    //
    // Multi-line forms use `^\}` (column-0 closing brace) as the
    // terminator — same heuristic the default-function strip uses to
    // tolerate nested indented braces inside the body.
    content = content.replace(/^export\s+default\s+function[^{]*\{[\s\S]*?^\}/gm, "");
    content = content.replace(/^export\s+(?:const|let|var)\s+\w+\s*=\s*\{[\s\S]*?^\};?/gm, "");
    content = content.replace(/^export\s+.*?(?:\n|$)/gm, "");

    // Strip JSX component tags. Treat opening, closing, and
    // self-closing tags independently rather than trying to pair
    // <Tag>...</Tag> with a non-greedy regex — that approach fails on
    // nested components (e.g. Astro Starlight's <Tabs><TabItem>...
    // </TabItem></Tabs>), leaving orphan opening tags in the output.
    //
    // For opening tags carrying a `label=` or `title=` attribute, emit
    // the value as an H3 heading before dropping the tag. Tauri,
    // Drizzle, and other Starlight-based docs use these attributes to
    // distinguish parallel content blocks (e.g. one TabItem per OS or
    // package manager); without them the agent sees a sequence of
    // commands with no context. The heading restores that.
    content = content.replace(/<[A-Z][A-Za-z0-9]*[^>]*\/>/g, "");
    content = content.replace(
      /<[A-Z][A-Za-z0-9]*\b[^>]*?\b(?:label|title)\s*=\s*["']([^"']+)["'][^>]*>/g,
      "\n\n### $1\n\n",
    );
    content = content.replace(/<[A-Z][A-Za-z0-9]*[^>]*>/g, "");
    content = content.replace(/<\/[A-Z][A-Za-z0-9]*>/g, "");

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    const newPath = file.path.replace(/\.mdx$/, ".md");
    return file.withContent(content).withPath(newPath);
  }
}
