import { describe, it, expect } from "vitest";
import { HtmlNormaliser } from "../../../src/normaliser/HtmlNormaliser.js";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("HtmlNormaliser", () => {
  const normaliser = new HtmlNormaliser();

  it("supports .html files", () => {
    expect(normaliser.supports(new DocFile("foo.html", ""))).toBe(true);
  });

  it("does not support .md files", () => {
    expect(normaliser.supports(new DocFile("foo.md", ""))).toBe(false);
  });

  it("converts basic HTML to markdown", async () => {
    const file = new DocFile(
      "index.html",
      `<h1>Title</h1><p>Some <strong>bold</strong> text.</p>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("**bold**");
  });

  it("converts code blocks", async () => {
    const file = new DocFile(
      "index.html",
      `<pre><code>SELECT * FROM users;</code></pre>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("SELECT * FROM users;");
  });

  it("changes extension from .html to .md", async () => {
    const file = new DocFile("reference/indexes.html", "<h1>Indexes</h1>");
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("reference/indexes.md");
  });

  it("strips nav and script elements", async () => {
    const file = new DocFile(
      "index.html",
      `<nav><a href="/">Home</a></nav><main><h1>Content</h1></main><script>alert(1)</script>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Content");
    expect(result.content).not.toContain("alert(1)");
  });
});
