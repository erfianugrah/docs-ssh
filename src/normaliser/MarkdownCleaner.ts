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
    // Must skip code fences to avoid stripping legitimate CSS examples
    content = stripCssOutsideFences(content);

    // Upstream markdown converters keep HTML they have no markdown for
    // (ansible <dl> blocks, some cloudflare-changelog lists) with raw
    // <a href> inside; rewrite those so the link graph and readers see
    // markdown links. Turndown output never has them.
    if (file.preNormalised) content = anchorsToMarkdownOutsideCode(content);

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

    // Narrow MediaWiki chrome: require more specific patterns to avoid
    // stripping legitimate "Search" or "Views" headings in non-wiki docs
    content = content.replace(
      /^(?:Navigation menu|Page actions?|Personal tools|Jump to navigation|Jump to search|Toolbox|In other languages)\s*$/gm,
      "",
    );

    // Collapse excessive blank lines
    content = content.replace(/\n{3,}/g, "\n\n").trim();

    return file.withContent(content);
  }
}

/**
 * `<a href="u" ...>text</a>` -> `[text](u)` outside fences and inline code.
 * `<a ...><code>x</code></a>` becomes `` [`x`](u) ``; anchors holding other
 * markup (`<img>`, `<span>`) are left as they are.
 */
function anchorsToMarkdownOutsideCode(content: string): string {
  if (!/<a\s/i.test(content)) return content;
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith("```") || t.startsWith("~~~")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      // Odd segments of a split on backticks are inline code spans.
      return line
        .split("`")
        .map((seg, i) =>
          i % 2
            ? seg
            : seg
                .replace(
                  /<a\s+href="([^"]*)"[^>]*>\s*<code>([^<`]*)<\/code>\s*<\/a>/gi,
                  (_m, href: string, text: string) => `[\`${text.trim()}\`](${href})`,
                )
                .replace(
                  /<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi,
                  (_m, href: string, text: string) => `[${text.trim()}](${href})`,
                ),
        )
        .join("`");
    })
    .join("\n");
}

/** Strip CSS selectors/blocks only when NOT inside fenced code blocks. */
function stripCssOutsideFences(content: string): string {
  const lines = content.split("\n");
  let inFence = false;
  const result: string[] = [];
  let skipMultiLine = false;

  for (const line of lines) {
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      skipMultiLine = false;
      result.push(line);
      continue;
    }

    if (inFence) {
      result.push(line);
      continue;
    }

    // Track multi-line CSS blocks: selector { ... }
    if (skipMultiLine) {
      if (line.match(/^\s*\}/)) {
        skipMultiLine = false;
      }
      continue;
    }

    // Single-line CSS: .class { prop: value; }
    if (/^[.#@][\w-]+[^{]*\{[^}]*\}\s*$/.test(line)) continue;

    // Multi-line CSS opening: .class {
    if (/^[.#@][\w-][^{]*\{\s*$/.test(line)) {
      skipMultiLine = true;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}
