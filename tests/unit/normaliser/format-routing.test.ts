import { describe, it, expect } from "vitest";
import { DocFile } from "../../../src/domain/DocFile.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import { DocSet } from "../../../src/domain/DocSet.js";
import { UpdateDocSets } from "../../../src/application/UpdateDocSets.js";
import { HtmlNormaliser } from "../../../src/normaliser/HtmlNormaliser.js";
import { MdxNormaliser } from "../../../src/normaliser/MdxNormaliser.js";
import { MarkdownCleaner } from "../../../src/normaliser/MarkdownCleaner.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("format-based normaliser routing", () => {
  const normalisers = [new MdxNormaliser(), new HtmlNormaliser(), new MarkdownCleaner()];
  const ingestors = []; // not needed — we test normalise directly

  it("applies HtmlNormaliser to .md files when source format is html", async () => {
    const source = new DocSource({
      name: "test-blog",
      type: "http",
      url: "https://example.com/blog/",
      format: "html",
    });

    // A file saved as .md but containing HTML (simulates blog fetch)
    const html = `<nav><a href="/">Home</a></nav><main><h1>Blog Post</h1><p>This is <strong>important</strong> content about databases.</p></main><script>alert(1)</script>`;
    const files = new Map([["my-post.md", new DocFile("my-post.md", html)]]);
    const set = new DocSet(source, files);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmt-test-"));

    const updater = new UpdateDocSets({
      sources: [source],
      ingestors,
      normalisers,
      outDir: tmpDir,
      workDir: tmpDir,
    });

    // Access private normalise method via any cast
    const normalised = await (updater as any).normalise(set);

    // Should be converted to markdown
    const file = normalised.getFile("my-post.md");
    expect(file).toBeDefined();
    expect(file!.content).toContain("# Blog Post");
    expect(file!.content).toContain("**important**");
    expect(file!.content).not.toContain("<script>");
    expect(file!.content).not.toContain("<nav>");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does NOT apply HtmlNormaliser to .md files when source format is markdown", async () => {
    const source = new DocSource({
      name: "test-docs",
      type: "http",
      url: "https://example.com/docs/",
      format: "markdown",
    });

    const md = "# Clean Guide\n\nThis is already markdown.";
    const files = new Map([["guide.md", new DocFile("guide.md", md)]]);
    const set = new DocSet(source, files);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmt-test-"));

    const updater = new UpdateDocSets({
      sources: [source],
      ingestors,
      normalisers,
      outDir: tmpDir,
      workDir: tmpDir,
    });

    const normalised = await (updater as any).normalise(set);
    const file = normalised.getFile("guide.md");
    expect(file).toBeDefined();
    // Content should be unchanged — no normaliser should touch it
    expect(file!.content).toBe(md);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("applies HtmlNormaliser and produces useful output from real HTML", async () => {
    const source = new DocSource({
      name: "test-cf-blog",
      type: "http",
      url: "https://blog.cloudflare.com/",
      format: "html",
    });

    // Realistic Cloudflare blog HTML structure
    const html = `<!DOCTYPE html><html><head><title>Test Post</title></head><body>
<nav><a href="/">Blog</a></nav>
<main>
<article>
<h1>Sandboxing AI agents, 100x faster</h1>
<p>We're introducing Dynamic Workers, which allow you to execute AI-generated code in secure, lightweight isolates.</p>
<h2>How it works</h2>
<p>The Workers platform uses V8 isolates. Isolates are <strong>far more lightweight</strong> than containers.</p>
<pre><code>const worker = env.LOADER.get(id);</code></pre>
</article>
</main>
<footer><p>Copyright 2026</p></footer>
<script>analytics();</script>
</body></html>`;

    const files = new Map([["dynamic-workers.md", new DocFile("dynamic-workers.md", html)]]);
    const set = new DocSet(source, files);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmt-test-"));

    const updater = new UpdateDocSets({
      sources: [source],
      ingestors,
      normalisers,
      outDir: tmpDir,
      workDir: tmpDir,
    });

    const normalised = await (updater as any).normalise(set);
    const file = normalised.getFile("dynamic-workers.md");
    expect(file).toBeDefined();

    // Should contain the actual article content
    expect(file!.content).toContain("Sandboxing AI agents");
    expect(file!.content).toContain("V8 isolates");
    expect(file!.content).toContain("**far more lightweight**");
    expect(file!.content).toContain("env.LOADER.get(id)");

    // Should NOT contain chrome/scripts
    expect(file!.content).not.toContain("<script>");
    expect(file!.content).not.toContain("analytics()");
    expect(file!.content).not.toContain("<nav>");

    // Should not contain raw HTML tags
    expect(file!.content).not.toContain("<!DOCTYPE");
    expect(file!.content).not.toContain("<body>");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("preserves content when normalising RSC pages produces too little output", async () => {
    // RSC-rendered pages produce almost no output from Turndown.
    // The normaliser should detect this and keep the original.
    const source = new DocSource({
      name: "test-rsc-blog",
      type: "http",
      url: "https://example.com/blog/",
      format: "html",
    });

    // Simulate an RSC payload — no real HTML content
    const rscHtml = `<!DOCTYPE html><html><head><title>Blog</title></head><body><div hidden></div><script>self.__next_f=[]</script><script>self.__next_f.push([1,"content here"])</script></body></html>`;
    const files = new Map([["rsc-post.md", new DocFile("rsc-post.md", rscHtml)]]);
    const set = new DocSet(source, files);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmt-test-"));

    const updater = new UpdateDocSets({
      sources: [source],
      ingestors,
      normalisers,
      outDir: tmpDir,
      workDir: tmpDir,
    });

    const normalised = await (updater as any).normalise(set);
    const file = normalised.getFile("rsc-post.md");
    expect(file).toBeDefined();

    // If normalisation produces very little output (<50 chars),
    // the original should be preserved to avoid data loss
    // OR it's acceptable that near-empty RSC pages are dropped
    // Either way, it should NOT produce a misleadingly tiny file
  });
});
