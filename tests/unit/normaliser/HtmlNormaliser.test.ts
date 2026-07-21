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

  // ─── Edge cases ───────────────────────────────────────────────────

  it("strips header and footer elements", async () => {
    const file = new DocFile(
      "page.html",
      `<header><h1>Site Header</h1></header><main><h2>Real Content</h2><p>Body.</p></main><footer>Copyright</footer>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("Real Content");
    expect(result.content).not.toContain("Site Header");
    expect(result.content).not.toContain("Copyright");
  });

  it("strips style elements", async () => {
    const file = new DocFile(
      "page.html",
      `<style>.red { color: red; }</style><h1>Styled</h1>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Styled");
    expect(result.content).not.toContain("color: red");
  });

  it("extracts content from <article> without <main>", async () => {
    const file = new DocFile(
      "page.html",
      `<nav>Nav</nav><article><h1>Article Only</h1><p>Content.</p></article><footer>Foot</footer>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("Article Only");
    expect(result.content).toContain("Content.");
  });

  it("extracts content from <main> with attributes", async () => {
    const file = new DocFile(
      "page.html",
      `<nav>Nav</nav><main class="content" id="main-area"><h1>Main Content</h1></main>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("Main Content");
  });

  it("preserves original when RSC page produces <1% output (input > 1000 chars)", async () => {
    // Input must be >1000 chars for the safety guard to activate
    const padding = `<script>self.__next_f.push([1,"${"x".repeat(1200)}"])</script>`;
    const rscHtml = `<!DOCTYPE html><html><body><div hidden></div>${padding}</body></html>`;
    expect(rscHtml.length).toBeGreaterThan(1000);

    const file = new DocFile("rsc.html", rscHtml);
    const result = await normaliser.normalise(file);
    // Safety guard keeps original: path stays .html, content preserved
    expect(result.path).toBe("rsc.html");
    expect(result.content).toBe(rscHtml);
  });

  it("does NOT trigger RSC guard when input < 1000 chars", async () => {
    // Small HTML should always be converted, even if result is tiny
    const smallHtml = `<h1>Hi</h1>`;
    expect(smallHtml.length).toBeLessThan(1000);

    const file = new DocFile("small.html", smallHtml);
    const result = await normaliser.normalise(file);
    // Should convert normally: path changes to .md
    expect(result.path).toBe("small.md");
    expect(result.content).toContain("# Hi");
  });

  it("falls back to full-page conversion when the <main|article> match is a tiny fragment", async () => {
    // WordPress/Oxygen-style pages: the FIRST <article> on the page is a
    // small comment block, and the real post body lives in plain <div>s.
    // The non-greedy selection regex captures the comment, so the selected
    // conversion is <1% of the input - but a full-page conversion yields
    // the real content. Must not keep the raw HTML in that case.
    const comment = `<article class="comment-body"><p>Great post!</p></article>`;
    const body = `<div id="inner-content"><h1>Real Guide</h1><p>${" substantive guidance.".repeat(80)}</p></div>`;
    const chrome = `<div class="sidebar">${"<a href='/x'>link</a>".repeat(60)}</div>`;
    const html = `<!DOCTYPE html><html><body>${comment}${body}${chrome}</body></html>`;
    expect(html.length).toBeGreaterThan(1000);

    const file = new DocFile("guide.html", html);
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("guide.md");
    expect(result.content).toContain("# Real Guide");
    expect(result.content).toContain("substantive guidance");
  });

  it("still keeps raw HTML when BOTH selected and full-page conversion are tiny (RSC shell)", async () => {
    // Same guard as the existing RSC test, but with an <article> present:
    // the fallback must not resurrect an SPA shell just because the
    // first-pass selection was also tiny.
    const padding = `<script>self.__next_f.push([1,"${"x".repeat(1500)}"])</script>`;
    const html = `<!DOCTYPE html><html><body><article><p>t</p></article><div hidden></div>${padding}</body></html>`;
    expect(html.length).toBeGreaterThan(1000);

    const file = new DocFile("shell.html", html);
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("shell.html");
    expect(result.content).toBe(html);
  });

  it("renames .md to .html when keeping raw HTML from an extension-less URL", async () => {
    // urlToPath gives extension-less upstream URLs a .md name before
    // normalisation runs; if the SPA-shell guard keeps the raw HTML,
    // the file must not masquerade as markdown.
    const padding = `<script>self.__next_f.push([1,"${"x".repeat(1200)}"])</script>`;
    const html = `<!DOCTYPE html><html><body><div hidden></div>${padding}</body></html>`;

    const file = new DocFile("chapter.md", html);
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("chapter.html");
    expect(result.content).toBe(html);
  });

  it("converts boilerplate-heavy pages whose real content fails the ratio test", async () => {
    // docs.redhat.com shape: ~780KB of PatternFly markup for a few KB
    // of chapter prose inside <main><article>. The 1% ratio guard must
    // not reject a substantive absolute-size conversion.
    const prose = `<article><h1>Chapter 21. Changing a hostname</h1><p>${" Real prose content.".repeat(150)}</p></article>`;
    const boilerplate = `<script type="importmap">${"x".repeat(40000)}</script>`;
    const html = `<!DOCTYPE html><html><head>${boilerplate}</head><body><main>${prose}</main></body></html>`;
    expect(html.length / 100).toBeGreaterThan(1); // prose < 1% of page

    const file = new DocFile("chapter.md", html);
    const result = await normaliser.normalise(file);
    expect(result.path).toBe("chapter.md");
    expect(result.content).toContain("# Chapter 21. Changing a hostname");
    expect(result.content).toContain("Real prose content");
  });

  it("supportsFormat returns true only for html", () => {
    expect(normaliser.supportsFormat("html")).toBe(true);
    expect(normaliser.supportsFormat("mdx")).toBe(false);
    expect(normaliser.supportsFormat("markdown")).toBe(false);
  });

  it("injects HTML <title> as H1 when content has no heading", async () => {
    const file = new DocFile(
      "page.html",
      `<html><head><title>Replication Guide | PostgreSQL wiki</title></head><body><p>Content about replication.</p></body></html>`,
    );
    const result = await normaliser.normalise(file);
    // Title should be injected with site suffix stripped
    expect(result.content).toContain("# Replication Guide");
    expect(result.content).not.toContain("PostgreSQL wiki");
    expect(result.content).toContain("Content about replication.");
  });

  it("does not duplicate H1 when content already has a heading", async () => {
    const file = new DocFile(
      "page.html",
      `<html><head><title>Guide</title></head><body><h1>Guide</h1><p>Content.</p></body></html>`,
    );
    const result = await normaliser.normalise(file);
    const h1Count = (result.content.match(/^# /gm) ?? []).length;
    expect(h1Count).toBe(1);
  });

  it("strips <script> whose body contains a literal '</script>' substring", async () => {
    // The previous regex-based strip `/<script[\s\S]*?<\/script>/gi`
    // terminated at the first `</script>` substring inside a JS string
    // literal, leaking the rest of the script (and any post-script
    // markup interpreted as JS source). Turndown's HTML parser
    // recognises that the inner `</script>` is inside a script body
    // and only closes on a real `</script>` element boundary.
    const file = new DocFile(
      "page.html",
      `<h1>Title</h1><script>const s = "<\\/script>"; console.log(s);</script><p>After.</p>`,
    );
    const result = await normaliser.normalise(file);
    expect(result.content).toContain("# Title");
    expect(result.content).toContain("After.");
    expect(result.content).not.toContain("console.log");
    expect(result.content).not.toContain("const s");
  });
});
