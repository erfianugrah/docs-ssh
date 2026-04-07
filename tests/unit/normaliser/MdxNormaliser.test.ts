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
});
