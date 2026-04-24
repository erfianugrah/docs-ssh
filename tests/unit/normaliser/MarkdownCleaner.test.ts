import { describe, it, expect } from "vitest";
import { MarkdownCleaner } from "../../../src/normaliser/MarkdownCleaner.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("MarkdownCleaner", () => {
  const cleaner = new MarkdownCleaner();

  // ─── supports() ────────────────────────────────────────────────────

  it("supports all .md files", () => {
    const file = new DocFile("page.md", "[Skip to content](#main)\n# Title");
    expect(cleaner.supports(file)).toBe(true);
  });

  it("supports .md files without boilerplate", () => {
    const file = new DocFile("clean.md", "# Clean Page\nNo boilerplate.");
    expect(cleaner.supports(file)).toBe(true);
  });

  it("does not support .html files even with [Skip to content]", () => {
    const file = new DocFile("page.html", "[Skip to content] some content");
    expect(cleaner.supports(file)).toBe(false);
  });

  it("does not support .mdx files even with [Skip to content]", () => {
    const file = new DocFile("page.mdx", "[Skip to content] some content");
    expect(cleaner.supports(file)).toBe(false);
  });

  // ─── [Skip to content] removal ─────────────────────────────────────

  it("strips [Skip to content](#main) link", async () => {
    const file = new DocFile("page.md", "[Skip to content](#main)\n\n# Title\n\nContent.");
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("[Skip to content]");
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("Content.");
  });

  it("strips [Skip to content](https://...) link", async () => {
    const file = new DocFile("page.md", "[Skip to content](https://example.com#main)\n\n# Title");
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("[Skip to content]");
    expect(result.content).toContain("# Title");
  });

  // ─── "Was this helpful?" removal ───────────────────────────────────

  it("strips 'Was this helpful? YesNo' block", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Guide\n\nContent.\n\nWas this helpful?\nYesNo\n",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("Was this helpful?");
    expect(result.content).not.toContain("YesNo");
    expect(result.content).toContain("Content.");
  });

  // ─── Edit/Report/Copy link removal ─────────────────────────────────

  it("strips [Edit page](...) links", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Title\n\n[Edit page](https://github.com/repo/edit)\n",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("[Edit page]");
    expect(result.content).toContain("# Title");
  });

  it("strips [Report issue](...) links", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Title\n\n[Report issue](https://github.com/repo/issues)\n",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("[Report issue]");
  });

  it("strips [Copy page](...) links", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Title\n\n[Copy page](javascript:void(0))\n",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("[Copy page]");
  });

  it("strips standalone 'Copy page' text", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Title\n\nCopy page\n\nContent.",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toMatch(/^Copy page$/m);
    expect(result.content).toContain("Content.");
  });

  // ─── JSON-LD BreadcrumbList removal ────────────────────────────────

  it("strips JSON-LD BreadcrumbList in code fences", async () => {
    const jsonLd = `\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Docs"}]
}
\`\`\``;
    const file = new DocFile(
      "page.md",
      `[Skip to content](#main)\n\n# Title\n\n${jsonLd}\n\nContent.`,
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("BreadcrumbList");
    expect(result.content).toContain("Content.");
  });

  it("strips standalone JSON-LD BreadcrumbList without code fence", async () => {
    const file = new DocFile(
      "page.md",
      `[Skip to content](#main)\n\n# Title\n\n{"@type": "BreadcrumbList", "itemListElement": []}\n\nContent.`,
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toContain("BreadcrumbList");
    expect(result.content).toContain("Content.");
  });

  // ─── Blank line collapse ───────────────────────────────────────────

  it("collapses excessive blank lines", async () => {
    const file = new DocFile(
      "page.md",
      "[Skip to content](#main)\n\n# Title\n\n\n\n\n\nContent.",
    );
    const result = await cleaner.normalise(file);
    expect(result.content).not.toMatch(/\n{3,}/);
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("Content.");
  });

  // ─── Full realistic page ──────────────────────────────────────────

  it("cleans a realistic Cloudflare docs page", async () => {
    const page = `[Skip to content](#main)

# Workers AI

Build and deploy AI models at the edge.

Was this helpful?
YesNo

[Edit page](https://github.com/cloudflare/cloudflare-docs/edit/main/workers-ai.md)

\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Docs"}]
}
\`\`\`

Copy page`;
    const file = new DocFile("workers-ai.md", page);
    const result = await cleaner.normalise(file);

    expect(result.content).toContain("# Workers AI");
    expect(result.content).toContain("Build and deploy AI models");
    expect(result.content).not.toContain("[Skip to content]");
    expect(result.content).not.toContain("Was this helpful?");
    expect(result.content).not.toContain("[Edit page]");
    expect(result.content).not.toContain("BreadcrumbList");
    expect(result.content).not.toMatch(/^Copy page$/m);
  });

  // ─── Preserves legitimate content ─────────────────────────────────

  it("does not alter content without boilerplate patterns", async () => {
    // A file that matches supports() but only has the Skip link — rest is clean
    const md = "[Skip to content](#main)\n\n# Real Guide\n\nThis is real content.\n\n```js\nconsole.log('hello');\n```";
    const file = new DocFile("guide.md", md);
    const result = await cleaner.normalise(file);
    expect(result.content).toContain("# Real Guide");
    expect(result.content).toContain("This is real content.");
    expect(result.content).toContain("console.log('hello');");
  });
});
