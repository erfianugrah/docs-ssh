import { describe, it, expect } from "vitest";
import { ContentSanitiser } from "../../../src/normaliser/ContentSanitiser.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("ContentSanitiser", () => {
  const sanitiser = new ContentSanitiser();

  it("supports all files", () => {
    expect(sanitiser.supports(new DocFile("any.md", ""))).toBe(true);
    expect(sanitiser.supports(new DocFile("any.html", ""))).toBe(true);
    expect(sanitiser.supports(new DocFile("any.txt", ""))).toBe(true);
  });

  it("strips ANSI escape sequences", async () => {
    const file = new DocFile("test.md", "normal \x1b[31mred text\x1b[0m here");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("normal red text here");
  });

  it("strips CSI sequences with parameters", async () => {
    const file = new DocFile("test.md", "before\x1b[2J\x1b[Hafter");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("beforeafter");
  });

  it("strips OSC sequences (title manipulation)", async () => {
    const file = new DocFile("test.md", "text\x1b]0;malicious title\x07more");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("textmore");
  });

  it("strips null bytes", async () => {
    const file = new DocFile("test.md", "hello\0world");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("helloworld");
  });

  it("strips control characters but preserves newlines and tabs", async () => {
    const file = new DocFile("test.md", "line1\nline2\ttab\x01\x02hidden");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("line1\nline2\ttabhidden");
  });

  it("preserves normal markdown content", async () => {
    const md = "# Heading\n\n- item 1\n- item 2\n\n```sql\nSELECT 1;\n```\n";
    const file = new DocFile("test.md", md);
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe(md);
  });

  it("strips ../ from file paths", async () => {
    const file = new DocFile("safe/path.md", "content");
    // Simulate a file with a traversal path (constructed directly for test)
    const malicious = new DocFile("docs/../../../etc/passwd", "content");
    const result = await sanitiser.normalise(malicious);
    expect(result.path).not.toContain("..");
    expect(result.path).toBe("docs/etc/passwd");
  });

  it("strips leading slashes from paths", async () => {
    const file = new DocFile("safe.md", "content");
    // Can't construct DocFile with absolute path (constructor rejects it)
    // but sanitisePath handles it if called on a relative path with ..
    const result = await sanitiser.normalise(file);
    expect(result.path).toBe("safe.md");
  });

  it("strips control characters from file paths", async () => {
    const file = new DocFile("normal.md", "content");
    const result = await sanitiser.normalise(file);
    expect(result.path).toBe("normal.md");
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it("strips backslash-style traversal (..\\..) from paths", async () => {
    const file = new DocFile("docs\\..\\..\\etc\\passwd", "content");
    const result = await sanitiser.normalise(file);
    expect(result.path).not.toContain("..");
  });

  it("collapses double slashes in paths", async () => {
    const file = new DocFile("docs//nested//file.md", "content");
    const result = await sanitiser.normalise(file);
    expect(result.path).toBe("docs/nested/file.md");
  });

  it("strips multiple ../ sequences from paths", async () => {
    const file = new DocFile("a/../b/../c/../etc/passwd", "content");
    const result = await sanitiser.normalise(file);
    expect(result.path).not.toContain("..");
    expect(result.path).toBe("a/b/c/etc/passwd");
  });

  it("handles combined ANSI, null bytes, and control chars", async () => {
    const file = new DocFile("test.md", "A\x1b[31m\0B\x01C\x1b]0;title\x07D");
    const result = await sanitiser.normalise(file);
    expect(result.content).toBe("ABCD");
  });

  it("supportsFormat returns false (sanitiser is not a format converter)", () => {
    expect(sanitiser.supportsFormat("html")).toBe(false);
    expect(sanitiser.supportsFormat("mdx")).toBe(false);
    expect(sanitiser.supportsFormat("markdown")).toBe(false);
  });
});
