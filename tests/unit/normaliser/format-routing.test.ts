import { describe, it, expect } from "vitest";
import { DocFile } from "../../../src/domain/DocFile.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import { DocSet } from "../../../src/domain/DocSet.js";
import { UpdateDocSets } from "../../../src/application/UpdateDocSets.js";
import { HtmlNormaliser } from "../../../src/normaliser/HtmlNormaliser.js";
import { MdxNormaliser } from "../../../src/normaliser/MdxNormaliser.js";
import { MarkdownCleaner } from "../../../src/normaliser/MarkdownCleaner.js";
import { ContentSanitiser } from "../../../src/normaliser/ContentSanitiser.js";
import type { DocNormaliser } from "../../../src/domain/DocNormaliser.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("format-based normaliser routing", () => {
  const normalisers = [new MdxNormaliser(), new HtmlNormaliser(), new MarkdownCleaner(), new ContentSanitiser()];
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

  it("drops the file when normalising RSC pages produces too little output", async () => {
    // RSC-rendered pages produce almost no output from Turndown.
    // HtmlNormaliser.ts empty-conversion guard: if input > 1000 chars and
    // output < 1% of input size, the page is dropped from the doc set -
    // a raw app-shell HTML page has no doc value and breaks the invariant
    // that markdown-capable sources contain only .md files.
    const source = new DocSource({
      name: "test-rsc-blog",
      type: "http",
      url: "https://example.com/blog/",
      format: "html",
    });

    // Simulate a large RSC payload - lots of script tags, no extractable HTML.
    // Must exceed 1000 chars to trigger the MIN_CONVERSION_RATIO guard.
    const rscPayload = `self.__next_f.push([1,"${"a]b[c".repeat(300)}"])`;
    const rscHtml = `<!DOCTYPE html><html><head><title>Blog</title></head><body><div hidden></div><script>${rscPayload}</script></body></html>`;
    expect(rscHtml.length).toBeGreaterThan(1000); // precondition

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
    // The dropped page must not survive under ANY name - neither the
    // original .md path nor a renamed .html path.
    expect(normalised.getFile("rsc-post.md")).toBeUndefined();
    expect(normalised.getFile("rsc-post.html")).toBeUndefined();
    expect(normalised.files.size).toBe(0);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Pass 1: MdxNormaliser ──────────────────────────────────────────

  it("applies MdxNormaliser to .md files when source format is mdx", async () => {
    const source = new DocSource({
      name: "test-mdx",
      type: "git",
      url: "https://github.com/example/docs",
      format: "mdx",
    });

    const mdx = `import { Card } from '@components/Card'

---
title: Guide
---

# Guide

<Card title="Setup">Follow these steps.</Card>

Regular paragraph.`;

    const files = new Map([["guide.md", new DocFile("guide.md", mdx)]]);
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
    // Import should be stripped
    expect(file!.content).not.toContain("import");
    // JSX tags should be stripped
    expect(file!.content).not.toContain("<Card");
    // Regular content preserved
    expect(file!.content).toContain("# Guide");
    expect(file!.content).toContain("Regular paragraph");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Pass 3: MarkdownCleaner runs after format conversion ──────────

  it("runs MarkdownCleaner after HtmlNormaliser (pass 3)", async () => {
    const source = new DocSource({
      name: "test-pass3",
      type: "http",
      url: "https://example.com/docs/",
      format: "html",
    });

    // HTML with skip-to-content link and feedback block that MarkdownCleaner removes
    const html = `<html><body>
<a class="skip-to-content" href="#main">Skip to content</a>
<main>
<h1>API Guide</h1>
<p>This is useful content.</p>
</main>
<div class="feedback">Was this helpful?</div>
<script type="application/ld+json">{"@type":"Article"}</script>
</body></html>`;

    const files = new Map([["api-guide.md", new DocFile("api-guide.md", html)]]);
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
    const file = normalised.getFile("api-guide.md");
    expect(file).toBeDefined();
    // HtmlNormaliser converted HTML → markdown
    expect(file!.content).toContain("# API Guide");
    expect(file!.content).not.toContain("<script>");
    // MarkdownCleaner should have stripped skip-to-content and feedback
    expect(file!.content).not.toContain("skip-to-content");
    expect(file!.content).not.toContain("Was this helpful");
    expect(file!.content).not.toContain("ld+json");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Pass 3: ContentSanitiser runs after cleanup ────────────────────

  it("runs ContentSanitiser in pass 3 (strips ANSI, null bytes)", async () => {
    const source = new DocSource({
      name: "test-sanitise",
      type: "http",
      url: "https://example.com/",
      format: "markdown",
    });

    // Markdown with ANSI escape codes and null bytes
    const content = "# Title\n\nSome \x1b[31mred\x1b[0m text with a \x00null byte.";
    const files = new Map([["dirty.md", new DocFile("dirty.md", content)]]);
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
    const file = normalised.getFile("dirty.md");
    expect(file).toBeDefined();
    // ANSI codes stripped
    expect(file!.content).not.toContain("\x1b[");
    expect(file!.content).toContain("red");
    // Null bytes stripped
    expect(file!.content).not.toContain("\x00");
    expect(file!.content).toContain("null byte");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Title preservation through full pipeline ───────────────────────

  it("MDX frontmatter title survives full pipeline as H1", async () => {
    const source = new DocSource({
      name: "test-mdx-title",
      type: "git",
      url: "https://github.com/example/docs",
      format: "mdx",
    });

    const mdx = `---
title: Hypnagogia
date: 2021-03-08
---

The perception of time has changed.`;

    const files = new Map([["post.mdx", new DocFile("post.mdx", mdx)]]);
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
    const file = normalised.getFile("post.md");
    expect(file).toBeDefined();
    // Title from frontmatter should be injected as H1
    expect(file!.content).toContain("# Hypnagogia");
    // Frontmatter itself should be stripped
    expect(file!.content).not.toContain("date: 2021-03-08");
    // Original content preserved
    expect(file!.content).toContain("perception of time");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Pre-normalised content bypass (content-negotiated markdown) ──

  it("skips Pass 1 (HtmlNormaliser) when DocFile.preNormalised is true", async () => {
    // Simulates a page fetched with Accept: text/markdown where the
    // upstream returned text/markdown directly (Cloudflare's Markdown
    // for Agents, Prisma docs, etc.). The ingestor flags the DocFile,
    // and the normaliser pipeline must not run it through Turndown
    // (which corrupts markdown via aggressive escaping).
    const source = new DocSource({
      name: "test-cn-skip",
      type: "http",
      url: "https://blog.cloudflare.com/",
      format: "html", // source declares html, but this file is pre-normalised
    });

    // Real markdown with characters Turndown would mangle:
    // backslashes, asterisks, underscores, brackets.
    const md = `---
title: Sandboxing AI agents
---

# Sandboxing AI agents, 100x faster

Use \`env.LOADER.get(id)\` to spawn a sandbox. The \`*spread*\` operator
copies _own_ properties. Backslash: \\n is a newline.

[Link](https://example.com/path_with_underscores)`;

    const files = new Map([
      ["post.md", new DocFile("post.md", md, { preNormalised: true })],
    ]);
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
    const file = normalised.getFile("post.md");
    expect(file).toBeDefined();

    // The H1, code spans, emphasis, underscores in URLs, and backslashes
    // all survive — none of which would have happened if HtmlNormaliser
    // had run Turndown on this markdown.
    expect(file!.content).toContain("# Sandboxing AI agents, 100x faster");
    expect(file!.content).toContain("`env.LOADER.get(id)`");
    expect(file!.content).toContain("path_with_underscores");
    expect(file!.content).toContain("\\n");
    // No double-escaping artifacts.
    expect(file!.content).not.toContain("\\\\n");
    expect(file!.content).not.toContain("\\_");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("still runs Pass 3 cleanup on pre-normalised content", async () => {
    // Pre-normalised content should still pass through MarkdownCleaner
    // and ContentSanitiser — the bypass only applies to format converters.
    const source = new DocSource({
      name: "test-cn-pass3",
      type: "http",
      url: "https://example.com/",
      format: "html",
    });

    // Markdown with cleanup-worthy junk: ANSI codes, null bytes,
    // skip-to-content link, feedback widget.
    const md =
      "# Title\n\n" +
      "[Skip to content](#main){.skip-to-content}\n\n" +
      "Real \x1b[31mcontent\x1b[0m here.\n\n" +
      "Embedded \x00null byte.\n\n" +
      "Was this page helpful?";

    const files = new Map([
      ["page.md", new DocFile("page.md", md, { preNormalised: true })],
    ]);
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
    const file = normalised.getFile("page.md");
    expect(file).toBeDefined();

    // Real content survives.
    expect(file!.content).toContain("# Title");
    expect(file!.content).toContain("content");
    // ContentSanitiser stripped ANSI + null bytes.
    expect(file!.content).not.toContain("\x1b[");
    expect(file!.content).not.toContain("\x00");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does NOT double-run MarkdownCleaner on markdown-format sources (Pass 2 fix)", async () => {
    // Regression test for pre-existing pipeline bug: when source.format
    // is "markdown" or "openapi" (no Pass 1 converter matches), Pass 2
    // used to fall back to any normaliser whose supports() returned
    // true. MarkdownCleaner supports `.md` files, so it ran in Pass 2,
    // then ran AGAIN in Pass 3. Fix: Pass 2 only considers format
    // converters.
    let cleanerCallCount = 0;
    const countingCleaner: DocNormaliser = {
      name: "CountingCleaner",
      supports: (f) => f.extension === "md",
      supportsFormat: () => false, // cleanup normaliser, not a format converter
      normalise: async (file) => {
        cleanerCallCount++;
        return file;
      },
    };

    const source = new DocSource({
      name: "test-md-source",
      type: "git",
      url: "https://github.com/x/y",
      format: "markdown", // no Pass 1 converter matches this format
    });

    const files = new Map([
      ["guide.md", new DocFile("guide.md", "# Guide\nContent.")],
      ["api.md", new DocFile("api.md", "# API\nDetails.")],
    ]);
    const set = new DocSet(source, files);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fmt-test-"));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors,
      normalisers: [
        new MdxNormaliser(),
        new HtmlNormaliser(),
        countingCleaner, // would have run twice per file before the fix
        new ContentSanitiser(),
      ],
      outDir: tmpDir,
      workDir: tmpDir,
    });

    await (updater as any).normalise(set);

    // Exactly 2 invocations (one per file in Pass 3), not 4.
    expect(cleanerCallCount).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("Pass 2 still routes .mdx files in markdown-format sources to MdxNormaliser", async () => {
    // Counterpart: the Pass 2 fix must not break its original intent.
    // A `format: "markdown"` source can legitimately contain `.mdx`
    // files which need MdxNormaliser to strip JSX. Verify this still
    // works after restricting Pass 2 to format converters.
    const source = new DocSource({
      name: "test-mixed-ext",
      type: "git",
      url: "https://github.com/x/y",
      format: "markdown",
    });

    const mdx = `import { Card } from '@components/Card'

# Title

<Card>JSX content</Card>

Regular text.`;

    const files = new Map([
      ["page.mdx", new DocFile("page.mdx", mdx)],
    ]);
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
    const file = normalised.getFile("page.md"); // MdxNormaliser renames
    expect(file).toBeDefined();
    expect(file!.content).not.toContain("import");
    expect(file!.content).not.toContain("<Card");
    expect(file!.content).toContain("# Title");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("mixed preNormalised and HTML files in one DocSet are handled per-file", async () => {
    // Simulates the in-the-wild case where most pages come back as
    // markdown via content negotiation, but a few (e.g. turborepo
    // /docs/openapi/* recovered via the 404→HTML fallback) come back
    // as HTML. The normaliser must dispatch per-file, not per-source.
    const source = new DocSource({
      name: "test-mixed",
      type: "http",
      url: "https://example.com/",
      format: "html",
    });

    const markdownFile = new DocFile(
      "markdown-page.md",
      "# Markdown Page\n\nReal *markdown* with `code` and [links](https://example.com/path_with_underscores).",
      { preNormalised: true },
    );
    const htmlFile = new DocFile(
      "html-page.md",
      "<html><body><main><h1>HTML Page</h1><p>Needs <strong>Turndown</strong> conversion.</p></main></body></html>",
      { preNormalised: false },
    );

    const files = new Map([
      [markdownFile.path, markdownFile],
      [htmlFile.path, htmlFile],
    ]);
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

    // Markdown file: untouched by Pass 1, underscores in URL preserved.
    const md = normalised.getFile("markdown-page.md");
    expect(md!.content).toContain("# Markdown Page");
    expect(md!.content).toContain("path_with_underscores");

    // HTML file: Pass 1 ran Turndown → markdown.
    const html = normalised.getFile("html-page.md");
    expect(html!.content).toContain("# HTML Page");
    expect(html!.content).toContain("**Turndown**");
    expect(html!.content).not.toContain("<strong>");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("HTML <title> survives full pipeline as H1", async () => {
    const source = new DocSource({
      name: "test-html-title",
      type: "http",
      url: "https://example.com/",
      format: "html",
    });

    const html = `<html><head><title>Self-hosted Deployments | Docs</title></head>
<body><p>Deploy your application to your own infrastructure.</p></body></html>`;

    const files = new Map([["deploy.md", new DocFile("deploy.md", html)]]);
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
    const file = normalised.getFile("deploy.md");
    expect(file).toBeDefined();
    // Title should be injected with site suffix stripped, hyphen preserved
    expect(file!.content).toContain("# Self-hosted Deployments");
    // Site suffix stripped
    expect(file!.content).not.toContain("| Docs");
    // Content preserved
    expect(file!.content).toContain("Deploy your application");

    await fs.rm(tmpDir, { recursive: true });
  });
});
