import { describe, it, expect } from "vitest";
import { MdxNormaliser } from "../../../src/normaliser/MdxNormaliser.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("MdxNormaliser", () => {
  const normaliser = new MdxNormaliser();

  it("supports .mdx files", () => {
    expect(normaliser.supports(new DocFile("foo.mdx", ""))).toBe(true);
  });

  it("does not support .md files", () => {
    expect(normaliser.supports(new DocFile("foo.md", ""))).toBe(false);
  });

  it("strips import statements", async () => {
    const file = new DocFile(
      "x.mdx",
      `import Foo from '@/components/Foo'\nimport { Bar } from '../Bar'\n\n# Title\n\nContent here.`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).not.toContain("import");
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("Content here.");
  });

  it("strips JSX component tags", async () => {
    const file = new DocFile(
      "x.mdx",
      `# Title\n\n<Callout type="warning">Watch out</Callout>\n\nSome text.`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).not.toContain("<Callout");
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("Some text.");
  });

  it("strips YAML frontmatter", async () => {
    const file = new DocFile(
      "x.mdx",
      `---\ntitle: Auth Guide\ndescription: How to do auth\n---\n\n# Auth Guide\n\nContent.`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).not.toContain("title:");
    expect(result.content).toContain("# Auth Guide");
  });

  it("preserves frontmatter title as H1 when content has no heading", async () => {
    const file = new DocFile(
      "x.mdx",
      `---\ntitle: Hypnagogia\n---\n\nThe perception of time has changed.`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Hypnagogia");
    expect(result.content).toContain("The perception of time has changed.");
    expect(result.content).not.toContain("title:");
  });

  it("does not duplicate H1 when content already has one matching frontmatter", async () => {
    const file = new DocFile(
      "x.mdx",
      `---\ntitle: Auth Guide\n---\n\n# Auth Guide\n\nContent.`,
    );
    const result = await normaliser.normalise(file);
    // Should have exactly one H1, not two
    const h1Count = (result.content.match(/^# /gm) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it("changes extension from .mdx to .md", async () => {
    const file = new DocFile("guides/auth.mdx", "# Auth");
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("guides/auth.md");
  });

  it("preserves standard markdown content", async () => {
    const content = `# Heading\n\n- item 1\n- item 2\n\n\`\`\`sql\nSELECT 1;\n\`\`\``;
    const file = new DocFile("x.mdx", content);
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Heading");
    expect(result.content).toContain("- item 1");
    expect(result.content).toContain("SELECT 1;");
  });

  it("strips nested JSX component tags (Tabs > TabItem pattern)", async () => {
    // Tauri/Astro Starlight style — a real-world failure mode where
    // the previous open-close-with-content regex couldn't match
    // overlapping inner components and left orphan opening tags
    // visible in the agent's view.
    const content = `# Setup\n\n<Tabs>\n  <TabItem label="Debian">\n\n\`\`\`sh\napt install foo\n\`\`\`\n\n  </TabItem>\n  <TabItem label="Arch">\n\n\`\`\`sh\npacman -S foo\n\`\`\`\n\n  </TabItem>\n</Tabs>\n\nDone.`;
    const file = new DocFile("x.mdx", content);
    const result = await normaliser.normalise(file);
    // No JSX tags remain (open, close, or self-closing)
    expect(result.content).not.toMatch(/<[A-Z][A-Za-z]*[^>]*>/);
    expect(result.content).not.toMatch(/<\/[A-Z][A-Za-z]*>/);
    // Inner code blocks are preserved
    expect(result.content).toContain("apt install foo");
    expect(result.content).toContain("pacman -S foo");
    expect(result.content).toContain("Done.");
  });

  it("strips JSX with attribute-bearing children (e.g. <Tabs syncKey>)", async () => {
    const content = `# X\n\n<Tabs syncKey="lang">\n<Tab label="JS" icon="js">code1</Tab>\n<Tab label="TS" icon="ts">code2</Tab>\n</Tabs>`;
    const file = new DocFile("x.mdx", content);
    const result = await normaliser.normalise(file);
    expect(result.content).not.toMatch(/<[A-Z]/);
    expect(result.content).not.toMatch(/<\/[A-Z]/);
    expect(result.content).toContain("code1");
    expect(result.content).toContain("code2");
  });
});
