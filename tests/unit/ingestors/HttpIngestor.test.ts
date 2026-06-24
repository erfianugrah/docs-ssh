import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpIngestor } from "../../../src/ingestors/HttpIngestor.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("HttpIngestor", () => {
  const ingestor = new HttpIngestor();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports http sources", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(true);
  });

  it("does not support git sources", () => {
    const src = new DocSource({ name: "x", type: "git", format: "markdown", url: "https://x.com" });
    expect(ingestor.supports(src)).toBe(false);
  });

  it("fetches urls and creates DocFiles", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<h1>Indexes</h1><p>About indexes.</p>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "postgres",
      type: "http",
      format: "html",
      url: "https://www.postgresql.org/docs/current/",
      urls: ["https://www.postgresql.org/docs/current/indexes.html"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.id).toBe("postgres");
    expect(set.size).toBe(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("caps in-flight requests at source.pageConcurrency", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    let inFlight = 0;
    let maxInFlight = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so concurrent calls within a batch overlap before resolving.
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, text: async () => "<h1>Post</h1><p>Body.</p>" };
    });
    vi.stubGlobal("fetch", mockFetch);

    const urls = Array.from({ length: 12 }, (_, i) => `https://blog.example.com/post-${i}/`);
    const src = new DocSource({
      name: "throttled-blog",
      type: "http",
      format: "html",
      url: "https://blog.example.com/",
      urls,
      pageConcurrency: 3,
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(12);
    expect(maxInFlight).toBeLessThanOrEqual(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws if a url fetch fails", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const src = new DocSource({
      name: "postgres",
      type: "http",
      format: "html",
      url: "https://x.com",
      urls: ["https://x.com/notfound.html"],
    });

    await expect(ingestor.ingest(src, tmpDir)).rejects.toThrow("404");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── fetchWithRetry behaviour (tested through ingest) ──────────────

  it("retries on 500 then succeeds", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<h1>Works</h1>",
      });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "retry-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page.html"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);
    // fetch called twice: first 500 (retried), then 200
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does not retry on 404 with backoff, but does attempt HTML fallback", async () => {
    // 404 is not retried via exponential backoff. fetchPage does try
    // ONE additional fetch with Accept: text/html to recover from
    // broken servers that 404 only when Accept: text/markdown is set
    // (real-world case: turborepo /docs/openapi/* pages). When both
    // attempts 404, the page fails — total 2 fetch calls.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "no-retry-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/missing.html"],
    });

    await expect(ingestor.ingest(src, tmpDir)).rejects.toThrow("404");
    // Initial Accept: markdown,html;q=0.9 → 404, then HTML-only fallback → 404.
    // Neither is retried via backoff. Total = 2.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("recovers via HTML fallback when origin 404s only with markdown Accept", async () => {
    // Real-world case verified on turborepo /docs/openapi/* pages:
    // returns 404 when Accept includes text/markdown, but 200 with
    // plain HTML when Accept is text/html or missing.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const accept = (init.headers as Record<string, string>)?.Accept ?? "";
      if (accept.startsWith("text/markdown,")) {
        // Broken server: 404 only when markdown is preferred
        return { ok: false, status: 404 };
      }
      // HTML-only path works
      return {
        ok: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<h1>Recovered</h1>",
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "broken-server-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/docs/openapi"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(false);
    expect(file.content).toBe("<h1>Recovered</h1>");
    // 2 calls: initial markdown attempt (404) + HTML fallback (200)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("retries on network error then succeeds", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "# Content",
      });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "network-retry-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/",
      urls: ["https://example.com/page.md"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("retries on 429 rate limit", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "# Rate limited then OK",
      });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "rate-limit-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/",
      urls: ["https://example.com/page.md"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: sitemap ────────────────────────────────────────────

  it("discovers URLs from a sitemap", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/getting-started</loc></url>
  <url><loc>https://example.com/docs/auth</loc></url>
  <url><loc>https://example.com/blog/post-1</loc></url>
</urlset>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("sitemap.xml")) {
        return { ok: true, text: async () => sitemapXml };
      }
      return { ok: true, text: async () => `<h1>${url}</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "sitemap-test",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      discovery: "sitemap",
      discoveryUrl: "https://example.com/sitemap.xml",
      urlPattern: "example\\.com/docs/",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Should have 2 pages (getting-started + auth), blog excluded by urlPattern
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("auto-detects sitemapindex when discovery is sitemap", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // A sitemapindex served where a sitemap was expected
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/en/sitemap.xml</loc></sitemap>
</sitemapindex>`;

    const childSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/intro</loc></url>
  <url><loc>https://example.com/docs/guide</loc></url>
</urlset>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("sitemap.xml") && !url.includes("/en/")) {
        return { ok: true, text: async () => sitemapIndex };
      }
      if (url.includes("/en/sitemap.xml")) {
        return { ok: true, text: async () => childSitemap };
      }
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "autodetect-test",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      discovery: "sitemap",
      discoveryUrl: "https://example.com/sitemap.xml",
      urlPattern: "example\\.com/docs/",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Should transparently handle the sitemapindex and find 2 child pages
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: llms-txt ───────────────────────────────────────────

  it("discovers URLs from llms.txt", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const llmsTxt = `# MCP Documentation
> Model Context Protocol

## Docs
- [Introduction](https://modelcontextprotocol.io/introduction)
- [Concepts](https://modelcontextprotocol.io/concepts)
`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("llms.txt")) {
        return { ok: true, text: async () => llmsTxt };
      }
      return { ok: true, text: async () => `# Content for ${url}` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "llms-txt-test",
      type: "http",
      format: "markdown",
      url: "https://modelcontextprotocol.io/",
      discovery: "llms-txt",
      discoveryUrl: "https://modelcontextprotocol.io/llms.txt",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("resolves relative paths in llms.txt", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Some llms.txt files use relative markdown links instead of absolute URLs
    const llmsTxt = `# Turborepo

## Docs
- [Introduction](index.md): Welcome to Turborepo
- [Installation](/getting-started/installation.md): Install guide
- [Caching](https://turbo.build/docs/caching): Cache docs
`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("llms.txt")) {
        return { ok: true, text: async () => llmsTxt };
      }
      return { ok: true, text: async () => `# Content for ${url}` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "relative-llms-test",
      type: "http",
      format: "html",
      url: "https://turbo.build/",
      discovery: "llms-txt",
      discoveryUrl: "https://turbo.build/llms.txt",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // index.md → https://turbo.build/index.md
    // /getting-started/installation.md → https://turbo.build/getting-started/installation.md
    // https://turbo.build/docs/caching → absolute, kept as-is
    expect(set.size).toBe(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: TOC ────────────────────────────────────────────────

  it("discovers URLs from an HTML table-of-contents page", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const tocHtml = `<html><body>
<a href="indexes.html">Indexes</a>
<a href="queries.html">Queries</a>
<a href="https://other.com/ext.html">External</a>
</body></html>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("bookindex.html")) {
        return { ok: true, text: async () => tocHtml };
      }
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "toc-test",
      type: "http",
      format: "html",
      url: "https://www.postgresql.org/docs/current/",
      discovery: "toc",
      discoveryUrl: "https://www.postgresql.org/docs/current/bookindex.html",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Should find indexes.html and queries.html (resolved against TOC URL base),
    // but not external link (different base URL)
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("discovers URLs from TOC with uppercase HREF (DocBook/XHTML)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const tocHtml = `<HTML><BODY>
<A HREF="preface.html">Preface</A>
<A HREF="intro.html">Introduction</A>
</BODY></HTML>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("index.html")) {
        return { ok: true, text: async () => tocHtml };
      }
      return { ok: true, text: async () => `<H1>Page</H1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "docbook-toc-test",
      type: "http",
      format: "html",
      url: "https://www.pgpool.net/docs/latest/en/html/",
      discovery: "toc",
      discoveryUrl: "https://www.pgpool.net/docs/latest/en/html/index.html",
      urlPattern: "pgpool\\.net",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("discovers non-.html URLs from a TOC page (wiki-style)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const tocHtml = `<html><body>
<a href="/wiki/Replication">Replication</a>
<a href="/wiki/Performance_Tips">Performance</a>
<a href="/wiki/Special:AllPages">All Pages</a>
<a href="/static/logo.png">Logo</a>
</body></html>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("AllPages")) {
        return { ok: true, text: async () => tocHtml };
      }
      return { ok: true, text: async () => `<h1>Wiki Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "wiki-toc-test",
      type: "http",
      format: "html",
      url: "https://wiki.example.org/wiki/",
      discovery: "toc",
      discoveryUrl: "https://wiki.example.org/wiki/Special:AllPages",
      urlPattern: "wiki\\.example\\.org/wiki/",
      urlExclude: "Special:",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Replication + Performance matched; Special:AllPages excluded; logo.png skipped
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: mediawiki ──────────────────────────────────────────

  it("discovers pages from MediaWiki API with pagination", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const page1 = JSON.stringify({
      query: { allpages: [
        { pageid: 1, title: "Replication" },
        { pageid: 2, title: "Performance Tips" },
      ]},
      continue: { apcontinue: "Q" },
    });
    const page2 = JSON.stringify({
      query: { allpages: [
        { pageid: 3, title: "Query Planning" },
      ]},
    });

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("api.php") && url.includes("apcontinue=Q")) {
        return { ok: true, text: async () => page2 };
      }
      if (url.includes("api.php")) {
        return { ok: true, text: async () => page1 };
      }
      return { ok: true, text: async () => `<h1>Wiki Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "mediawiki-test",
      type: "http",
      format: "html",
      url: "https://wiki.example.org/wiki/",
      discovery: "mediawiki",
      discoveryUrl: "https://wiki.example.org/api.php",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // 2 pages from first batch + 1 from second = 3
    expect(set.size).toBe(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── URL filtering ─────────────────────────────────────────────────

  it("applies urlExclude filter", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<h1>Page</h1>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "exclude-test",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      urls: [
        "https://example.com/docs/auth.html",
        "https://example.com/docs/biblio.html",
        "https://example.com/docs/guide.html",
      ],
      urlExclude: "biblio\\.html",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2); // auth + guide, biblio excluded

    await fs.rm(tmpDir, { recursive: true });
  });

  it("applies urlSuffix", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () => `# Page ${url}`,
    }));
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "suffix-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/blog/",
      urls: ["https://example.com/blog/post-1/"],
      urlSuffix: ".md",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);
    // Verify the fetch was called with the suffix appended
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/blog/post-1.md",
      expect.any(Object),
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: sitemap-index ──────────────────────────────────────

  it("discovers URLs from a sitemap index", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-docs.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-blog.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pricing.xml</loc></sitemap>
</sitemapindex>`;

    const docsSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/auth</loc></url>
  <url><loc>https://example.com/docs/storage</loc></url>
</urlset>`;

    const blogSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/blog/post-1</loc></url>
</urlset>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("sitemap.xml")) return { ok: true, text: async () => sitemapIndex };
      if (url.includes("sitemap-docs")) return { ok: true, text: async () => docsSitemap };
      if (url.includes("sitemap-blog")) return { ok: true, text: async () => blogSitemap };
      if (url.includes("sitemap-pricing")) return { ok: true, text: async () => `<urlset></urlset>` };
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "sitemap-index-test",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      discovery: "sitemap-index",
      discoveryUrl: "https://example.com/sitemap.xml",
      urlPattern: "(docs|blog)",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // urlPattern pre-filters child sitemaps: "docs" and "blog" match, "pricing" doesn't.
    // Then urlPattern filters page URLs: 2 docs + 1 blog = 3 pages
    expect(set.size).toBe(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("sitemap-index falls back to all children when keywords match none", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap_1_of_5.xml</loc></sitemap>
</sitemapindex>`;

    const childSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/intro</loc></url>
</urlset>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("sitemap.xml")) return { ok: true, text: async () => sitemapIndex };
      if (url.includes("sitemap_1")) return { ok: true, text: async () => childSitemap };
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "sitemap-index-fallback",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      discovery: "sitemap-index",
      discoveryUrl: "https://example.com/sitemap.xml",
      // keywords "docs" won't match "sitemap_1_of_5.xml" -> fallback to all children
      urlPattern: "(docs)",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: llms-index ─────────────────────────────────────────

  it("discovers URLs from an llms-index (two-phase discovery)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const topLevelLlms = `# AWS Documentation
> Amazon Web Services documentation

## Services
- [Lambda](https://docs.aws.amazon.com/lambda/llms.txt)
- [S3](https://docs.aws.amazon.com/AmazonS3/llms.txt)
- [CloudWatch](https://docs.aws.amazon.com/cloudwatch/llms.txt)
`;

    const lambdaLlms = `# Lambda Documentation
- [Getting Started](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html)
- [Functions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-functions.html)
`;

    const s3Llms = `# S3 Documentation
- [Buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/buckets.html)
`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://docs.aws.amazon.com/llms.txt") {
        return { ok: true, text: async () => topLevelLlms };
      }
      if (url.includes("lambda/llms.txt")) {
        return { ok: true, text: async () => lambdaLlms };
      }
      if (url.includes("AmazonS3/llms.txt")) {
        return { ok: true, text: async () => s3Llms };
      }
      // cloudwatch is excluded by urlPattern
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "llms-index-test",
      type: "http",
      format: "html",
      url: "https://docs.aws.amazon.com/",
      discovery: "llms-index",
      discoveryUrl: "https://docs.aws.amazon.com/llms.txt",
      urlPattern: "(lambda|AmazonS3)",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Lambda: 2 pages + S3: 1 page = 3 total (cloudwatch filtered out by urlPattern)
    expect(set.size).toBe(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("discovers .md page URLs from llms-index (AWS new format)", async () => {
    // AWS upstream switched from .html page URLs to .md in their child
    // llms.txt files. The crawler must accept both.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const topLevel = `# AWS
- [Lambda](https://docs.aws.amazon.com/lambda/llms.txt)
`;
    const lambdaLlms = `# Lambda
- [Getting Started](https://docs.aws.amazon.com/lambda/latest/dg/getting-started.md)
- [Functions](https://docs.aws.amazon.com/lambda/latest/dg/functions.md)
- [Handler](https://docs.aws.amazon.com/lambda/latest/dg/handler.md)
`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://docs.aws.amazon.com/llms.txt") {
        return { ok: true, text: async () => topLevel };
      }
      if (url.endsWith("lambda/llms.txt")) {
        return { ok: true, text: async () => lambdaLlms };
      }
      // Page fetches return markdown body
      return { ok: true, text: async () => `# Page\n\nContent` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "aws-md-test",
      type: "http",
      format: "markdown",
      url: "https://docs.aws.amazon.com/",
      discovery: "llms-index",
      discoveryUrl: "https://docs.aws.amazon.com/llms.txt",
      urlPattern: "(lambda)",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: RSS ─────────────────────────────────────────────────

  it("discovers URLs from an RSS feed", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Cloudflare changelogs</title>
  <link>https://developers.cloudflare.com/changelog/</link>
  <item>
    <title>Workers - Deploy Hooks</title>
    <link>https://developers.cloudflare.com/changelog/post/2026-04-01-deploy-hooks/</link>
    <description>Deploy Hooks are now available.</description>
  </item>
  <item>
    <title>WAF Release</title>
    <link>https://developers.cloudflare.com/changelog/post/2026-04-07-waf-release/</link>
    <description>New WAF rules.</description>
  </item>
</channel>
</rss>`;

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("index.xml")) {
        return { ok: true, text: async () => rssFeed };
      }
      return { ok: true, text: async () => `<h1>Changelog entry</h1><p>Details here.</p>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "rss-test",
      type: "http",
      format: "html",
      url: "https://developers.cloudflare.com/changelog/",
      discovery: "rss",
      discoveryUrl: "https://developers.cloudflare.com/changelog/rss/index.xml",
      urlPattern: "developers\\.cloudflare\\.com/changelog/post/",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // 2 items in the RSS, both match urlPattern
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Deduplication ─────────────────────────────────────────────────

  it("deduplicates URLs", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "# Page",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "dedup-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/",
      urls: [
        "https://example.com/docs/auth",
        "https://example.com/docs/auth", // duplicate
        "https://example.com/docs/storage",
      ],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2); // deduplicated
    // fetch called only twice (not three times)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: llms-full ───────────────────────────────────────────

  it("discovers pages from llms-full.txt by splitting", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Vercel-style llms-full.txt with two pages separated by --- blocks
    const llmsFullContent = [
      "--------------------------------------------------------------------------------",
      'title: "Getting Started"',
      'source: "https://example.com/docs/getting-started"',
      "--------------------------------------------------------------------------------",
      "",
      "# Getting Started",
      "",
      "Welcome to the docs.",
      "",
      "--------------------------------------------------------------------------------",
      'title: "Auth"',
      'source: "https://example.com/docs/auth"',
      "--------------------------------------------------------------------------------",
      "",
      "# Auth",
      "",
      "Learn about authentication.",
    ].join("\n");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => llmsFullContent,
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "llms-full-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/docs/",
      discovery: "llms-full",
      discoveryUrl: "https://example.com/docs/llms-full.txt",
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2);
    // Fetch only called once — the llms-full.txt itself
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("applies urlExclude filter to llms-full pages", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // The splitter strips baseUrl from source, producing relative file paths.
    // urlPattern/urlExclude match against those file paths, not original URLs.
    // With baseUrl "https://example.com/docs/", source "https://example.com/docs/getting-started"
    // becomes "getting-started.md", and "https://example.com/docs/changelog"
    // becomes "changelog.md".
    const llmsFullContent = [
      "--------------------------------------------------------------------------------",
      'title: "Getting Started"',
      'source: "https://example.com/docs/getting-started"',
      "--------------------------------------------------------------------------------",
      "",
      "# Getting Started",
      "",
      "--------------------------------------------------------------------------------",
      'title: "Changelog"',
      'source: "https://example.com/docs/changelog"',
      "--------------------------------------------------------------------------------",
      "",
      "# Changelog",
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => llmsFullContent,
    }));

    const src = new DocSource({
      name: "llms-full-filter-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/docs/",
      discovery: "llms-full",
      discoveryUrl: "https://example.com/docs/llms-full.txt",
      urlExclude: "changelog",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // "getting-started.md" passes, "changelog.md" excluded
    expect(set.size).toBe(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: tarball ─────────────────────────────────────────────

  it("discovers pages from a tarball", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Create a real .tar.gz with two markdown files
    const tarDir = path.join(tmpDir, "tar-source");
    await fs.mkdir(path.join(tarDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(tarDir, "docs", "intro.md"), "# Intro\n\nWelcome.");
    await fs.writeFile(path.join(tarDir, "docs", "guide.md"), "# Guide\n\nStep by step.");
    await fs.writeFile(path.join(tarDir, "docs", "image.png"), "not-markdown");

    // Create tarball using tar
    const tarballPath = path.join(tmpDir, "docs.tar.gz");
    const { execFileSync } = await import("node:child_process");
    execFileSync("tar", ["-czf", tarballPath, "-C", tarDir, "."], { stdio: "pipe" });

    const tarballBuffer = await fs.readFile(tarballPath);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => tarballBuffer.buffer.slice(
        tarballBuffer.byteOffset,
        tarballBuffer.byteOffset + tarballBuffer.byteLength,
      ),
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "tarball-test",
      type: "http",
      format: "markdown",
      url: "https://example.com/docs/",
      discovery: "tarball",
      discoveryUrl: "https://example.com/docs/docs.tar.gz",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // Only .md files extracted, not .png
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: openapi ─────────────────────────────────────────────

  it("discovers pages from an OpenAPI spec", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const openApiSpec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/users": {
          get: { tags: ["users"], summary: "List users", responses: { "200": { description: "OK" } } },
        },
        "/items": {
          get: { tags: ["items"], summary: "List items", responses: { "200": { description: "OK" } } },
          post: { tags: ["items"], summary: "Create item", responses: { "201": { description: "Created" } } },
        },
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => openApiSpec,
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "openapi-test",
      type: "http",
      format: "openapi",
      url: "https://example.com/api/",
      discovery: "openapi",
      discoveryUrl: "https://example.com/api/spec.json",
    });

    const set = await ingestor.ingest(src, tmpDir);
    // overview.md + users.md + items.md = 3 files
    expect(set.size).toBe(3);
    expect(set.hasFile("api/overview.md")).toBe(true);
    expect(set.hasFile("api/users.md")).toBe(true);
    expect(set.hasFile("api/items.md")).toBe(true);
    // Only 1 fetch — the spec itself
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Discovery: none (explicit urls) ────────────────────────────────

  it("fetches explicit urls when discovery is none", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      text: async () => `<h1>Spec Page</h1><p>Content for ${url}</p>`,
    }));
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "explicit-urls-test",
      type: "http",
      format: "html",
      url: "https://specs.example.org/",
      urls: [
        "https://specs.example.org/core-1_0.html",
        "https://specs.example.org/discovery-1_0.html",
      ],
    });

    const set = await ingestor.ingest(src, tmpDir);
    expect(set.size).toBe(2);
    // Fetch called once per explicit URL
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Partial failure handling ─────────────────────────────────────────

  it("succeeds with partial failures (some pages fail, others succeed)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("broken")) return { ok: false, status: 500 };
      return { ok: true, text: async () => `<h1>Page</h1>` };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "partial-fail-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: [
        "https://example.com/good1.html",
        "https://example.com/broken.html",
        "https://example.com/good2.html",
      ],
    });

    const set = await ingestor.ingest(src, tmpDir);
    // 2 succeed, 1 fails (after retries) — should not throw
    expect(set.size).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws when ALL pages fail", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "all-fail-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: [
        "https://example.com/a.html",
        "https://example.com/b.html",
      ],
    });

    await expect(ingestor.ingest(src, tmpDir)).rejects.toThrow("all fetches failed");

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Max retries exhausted ──────────────────────────────────────────

  it("throws after exhausting all retries on 500", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "exhaust-retry-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page.html"],
    });

    await expect(ingestor.ingest(src, tmpDir)).rejects.toThrow("500");
    // initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Retry-After honoured ──────────────────────────────────────────

  it("waits for Retry-After header instead of exponential backoff", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        // First call: 429 with explicit Retry-After hint.
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "1" }),
          text: async () => "rate limited",
        };
      }
      // Second call succeeds.
      return { ok: true, text: async () => "<h1>ok</h1>" };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "retry-after-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page.html"],
    });

    const t0 = Date.now();
    const set = await ingestor.ingest(src, tmpDir);
    const elapsed = Date.now() - t0;

    expect(set.size).toBe(1);
    expect(calls).toBe(2);
    // Retry-After: 1 → 1000ms wait. Backoff base would only have been
    // ~1000ms here too, so the differentiator: should not be < 800ms
    // (proves we actually waited).
    expect(elapsed).toBeGreaterThanOrEqual(800);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── AbortSignal honoured ──────────────────────────────────────────

  // ─── Markdown content negotiation (acceptmarkdown.com spec) ──────

  it("sends Accept: text/markdown, text/html;q=0.9 on page fetches", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<h1>Page</h1>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "accept-header-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/docs/intro"],
    });

    await ingestor.ingest(src, tmpDir);

    // The page fetch should have sent the weighted Accept header.
    const call = mockFetch.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("intro"),
    );
    expect(call).toBeDefined();
    const init = call![1] as { headers?: Record<string, string> };
    expect(init.headers).toMatchObject({
      Accept: "text/markdown, text/html;q=0.9",
    });

    await fs.rm(tmpDir, { recursive: true });
  });

  it("flags DocFile.preNormalised=true when Content-Type is text/markdown", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const markdownBody = "# Workers\n\nBuild and deploy.".padEnd(500, " ");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/markdown; charset=utf-8" }),
      text: async () => markdownBody,
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "markdown-response-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/workers"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(true);
    expect(file.content).toContain("# Workers");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("flags DocFile.preNormalised=false when Content-Type is text/html", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => "<h1>Page</h1>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "html-response-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/docs"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(false);
    // HTML content stored as-is — normalisation pipeline (not ingestor)
    // is responsible for Turndown conversion.
    expect(file.content).toBe("<h1>Page</h1>");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("falls back to HTML when markdown response is suspiciously thin", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // First fetch returns a near-empty markdown body (simulates an
    // origin that pre-processes the page too aggressively). Second
    // fetch with Accept: text/html returns real content.
    const thinMarkdown = "# stub";
    const fullHtml = "<h1>Real content</h1>" + "<p>body</p>".repeat(20);
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++;
      const accept = (init.headers as Record<string, string>)?.Accept ?? "";
      if (accept.startsWith("text/markdown,")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/markdown; charset=utf-8" }),
          text: async () => thinMarkdown,
        };
      }
      // Forced HTML fallback
      return {
        ok: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => fullHtml,
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "thin-md-fallback-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/over-stripped"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];

    // Should have used the HTML fallback — flag false, content is the
    // full HTML body, not the thin markdown stub.
    expect(file.preNormalised).toBe(false);
    expect(file.content).toBe(fullHtml);
    // Two fetches: initial markdown attempt + forced-HTML retry.
    expect(callCount).toBe(2);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("keeps markdown response when body is above thin-body threshold", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Above MIN_MARKDOWN_BODY (256 bytes) — no fallback should fire.
    const markdownBody = "# Real markdown\n\n".padEnd(400, "x");
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "text/markdown; charset=utf-8" }),
      text: async () => markdownBody,
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "no-fallback-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(true);
    expect(file.content).toBe(markdownBody);
    // Single fetch only — no fallback.
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("handles missing Content-Type header by treating as HTML", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Some upstreams (or our minimal test mocks) omit headers entirely.
    // The ingestor must not crash — default to non-markdown.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<h1>Page</h1>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "no-headers-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does NOT send Accept: text/markdown on discovery URLs (sitemap)", async () => {
    // Regression guard: discovery fetches (sitemap, llms.txt, RSS, etc.)
    // must NOT advertise a markdown preference. Some upstreams would
    // return the wrong content type for the discovery file if asked,
    // breaking page enumeration. Only page fetches negotiate markdown.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/docs/intro</loc></url>
</urlset>`;

    const calls: Array<{ url: string; accept?: string }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const headers = (init.headers as Record<string, string>) ?? {};
      calls.push({ url, accept: headers.Accept });
      if (url.endsWith("sitemap.xml")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/xml" }),
          text: async () => sitemapXml,
        };
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<h1>Page</h1>",
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "discovery-accept-test",
      type: "http",
      format: "html",
      url: "https://example.com/docs/",
      discovery: "sitemap",
      discoveryUrl: "https://example.com/sitemap.xml",
      urlPattern: "example\\.com/docs/",
    });

    await ingestor.ingest(src, tmpDir);

    const sitemapCall = calls.find((c) => c.url.endsWith("sitemap.xml"));
    const pageCall = calls.find((c) => c.url.includes("intro"));
    expect(sitemapCall).toBeDefined();
    expect(pageCall).toBeDefined();
    // Sitemap fetch must NOT advertise markdown preference.
    expect(sitemapCall!.accept).toBeUndefined();
    // Page fetch MUST advertise markdown preference.
    expect(pageCall!.accept).toBe("text/markdown, text/html;q=0.9");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("handles Content-Type with charset suffix and mixed case", async () => {
    // RFC 7763 defines text/markdown but servers vary on capitalisation
    // and parameters. All of these must be recognised as markdown.
    const variants = [
      "text/markdown",
      "text/markdown; charset=utf-8",
      "text/markdown;version=GFM",
      "Text/Markdown; charset=UTF-8",
      "TEXT/MARKDOWN",
      "text/x-markdown",
    ];

    for (const ct of variants) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": ct }),
          text: async () => "# Page".padEnd(500, " "),
        }),
      );

      const src = new DocSource({
        name: `ct-test-${ct.replace(/\W+/g, "-")}`,
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: ["https://example.com/page"],
      });

      const set = await ingestor.ingest(src, tmpDir);
      const [file] = [...set.files.values()];
      expect(file.preNormalised, `failed for Content-Type: ${ct}`).toBe(true);

      await fs.rm(tmpDir, { recursive: true });
      vi.unstubAllGlobals();
    }
  });

  it("rewrites .html → .md path when origin returns markdown", async () => {
    // Regression: trailing-slash URLs default to `index.html` via
    // urlToPath, and URLs without an extension also get `.html` when
    // they don't already end in `.md` or `.html`. When the response
    // body is markdown (preNormalised=true), the file MUST be written
    // with a `.md` extension — otherwise MarkdownCleaner's
    // `file.extension === "md"` gate skips cleanup, and the on-disk
    // filename misleads operators/agents.
    //
    // Mirrors HtmlNormaliser's path rename at the end of its pass.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/markdown" }),
        text: async () =>
          "# Page title\n\nA real markdown document with body text.".padEnd(500, " "),
      }),
    );

    const src = new DocSource({
      name: "path-rewrite-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: [
        "https://example.com/page/",         // trailing slash → would become page/index.html
        "https://example.com/article.html",  // explicit .html
        "https://example.com/about",         // no extension → would become about.md already
      ],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const paths = [...set.files.keys()].sort();

    // All three should now have .md extension (markdown content).
    expect(paths).toEqual([
      "about.md",
      "article.md",
      "page/index.md",
    ]);

    // And the preNormalised flag is intact, so Pass 1 will skip
    // Turndown and Pass 3 (which gates on .md) will run cleanup.
    for (const file of set.files.values()) {
      expect(file.preNormalised).toBe(true);
    }

    await fs.rm(tmpDir, { recursive: true });
  });

  it("keeps .html path when origin returns HTML (Turndown will rename later)", async () => {
    // Counterpart: when the response is HTML, urlToPath's `.html`
    // assignment is correct. HtmlNormaliser's Pass 1 handles the
    // rename to `.md` after conversion. Verify ingestor does NOT
    // pre-rename in that case.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<h1>Page</h1>",
      }),
    );

    const src = new DocSource({
      name: "no-rewrite-html-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page/"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.path).toBe("page/index.html"); // unchanged
    expect(file.preNormalised).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("honours application/markdown even though RFC 7763 only standardises text/markdown", async () => {
    // Some less-compliant origins emit application/markdown. The body
    // shape is identical so we accept it — downstream parsers care
    // about content, not the bikeshed.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/markdown" }),
        text: async () => "# Hello\n\nA markdown document.".padEnd(500, " "),
      }),
    );

    const src = new DocSource({
      name: "application-markdown-ct",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does not treat text/plain or application/octet-stream as markdown", async () => {
    // Belt-and-braces: ambiguous content types must not be coerced into
    // the markdown branch. text/plain in particular is what some origins
    // send for llms-style dumps and we'd corrupt them by skipping
    // Turndown only to find raw HTML inside.
    const ambiguous = ["text/plain", "text/plain; charset=utf-8", "application/octet-stream"];

    for (const ct of ambiguous) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": ct }),
          text: async () => "<h1>Page</h1>",
        }),
      );

      const src = new DocSource({
        name: `ambiguous-ct-${ct.replace(/\W+/g, "-")}`,
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: ["https://example.com/page"],
      });

      const set = await ingestor.ingest(src, tmpDir);
      const [file] = [...set.files.values()];
      expect(file.preNormalised, `failed for Content-Type: ${ct}`).toBe(false);

      await fs.rm(tmpDir, { recursive: true });
      vi.unstubAllGlobals();
    }
  });

  // ─── Body-content sniffing (lying Content-Type) ────────────────────

  it("treats HTML body as HTML even when Content-Type claims markdown", async () => {
    // Some origins misconfigure their CDN and respond with the wrong
    // Content-Type. Body shape is the tie-breaker. Tests several common
    // HTML preambles.
    const htmlBodies = [
      "<!doctype html>\n<html><body>...</body></html>",
      "<!DOCTYPE HTML PUBLIC ...>\n<html>...",
      "<html><body><h1>Page</h1></body></html>",
      "  \n  <html lang=\"en\">...",  // leading whitespace
    ];

    for (const body of htmlBodies) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "text/markdown" }),
          text: async () => body.padEnd(500, " "),
        }),
      );

      const src = new DocSource({
        name: `lying-ct-${body.slice(0, 20).replace(/\W+/g, "-")}`,
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: ["https://example.com/page"],
      });

      const set = await ingestor.ingest(src, tmpDir);
      const [file] = [...set.files.values()];
      expect(
        file.preNormalised,
        `body sniff should have overridden for: ${body.slice(0, 30)}…`,
      ).toBe(false);

      await fs.rm(tmpDir, { recursive: true });
      vi.unstubAllGlobals();
    }
  });

  it("does not body-sniff false-positive on legitimate markdown with HTML mentions", async () => {
    // The sniff only checks the leading ~200 chars after trim. A
    // markdown doc that talks about HTML in its body shouldn't be
    // mistakenly downgraded.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));
    const body =
      "# HTML primer\n\n" +
      "This page describes the `<!doctype html>` declaration:\n\n" +
      "```html\n<!doctype html>\n<html>...</html>\n```\n\n" +
      "Note how the doctype must appear first in the document.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/markdown" }),
        text: async () => body,
      }),
    );

    const src = new DocSource({
      name: "md-talking-about-html",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page"],
    });

    const set = await ingestor.ingest(src, tmpDir);
    const [file] = [...set.files.values()];
    expect(file.preNormalised).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── Telemetry: x-markdown-tokens + per-source adoption log ─────

  it("logs negotiation stats when markdown was negotiated", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "content-type": "text/markdown; charset=utf-8",
        "x-markdown-tokens": "1368",
      }),
      text: async () => "# Page".padEnd(500, " "),
    });
    vi.stubGlobal("fetch", mockFetch);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const src = new DocSource({
        name: "telemetry-test",
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: ["https://example.com/a", "https://example.com/b"],
      });
      await ingestor.ingest(src, tmpDir);
    } finally {
      console.log = origLog;
    }

    const stats = logs.find((l) => l.includes("negotiated markdown"));
    expect(stats).toBeDefined();
    // Adoption rate (2/2 = 100%)
    expect(stats).toContain("2/2");
    expect(stats).toContain("100%");
    // Token count surfaced from header (1368 tokens per page)
    expect(stats).toMatch(/~1368 tokens\/page/);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does NOT log negotiation stats for pure-HTML sources (no noise)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<h1>Page</h1>",
      }),
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const src = new DocSource({
        name: "html-only-noisy-test",
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: ["https://example.com/a"],
      });
      await ingestor.ingest(src, tmpDir);
    } finally {
      console.log = origLog;
    }

    // Should NOT print a negotiation-stats line — keeps the build log
    // readable for the majority of sources that don't negotiate.
    expect(logs.find((l) => l.includes("negotiated markdown"))).toBeUndefined();
    expect(logs.find((l) => l.includes("via HTML fallback"))).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });

  it("counts fallback branches separately in negotiation stats", async () => {
    // 4 URLs:
    //   /good       → markdown
    //   /openapi    → 404 with markdown Accept → recovered via HTML
    //   /thin       → markdown but body is empty → swapped to HTML
    //   /lying      → markdown CT but body is HTML → routed to HTML pipeline
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const accept = (init.headers as Record<string, string>)?.Accept ?? "";
      if (url.endsWith("/good")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/markdown" }),
          text: async () => "# Good".padEnd(500, " "),
        };
      }
      if (url.endsWith("/openapi")) {
        if (accept.startsWith("text/markdown,")) {
          return { ok: false, status: 404 };
        }
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          text: async () => "<h1>OpenAPI</h1>".padEnd(500, " "),
        };
      }
      if (url.endsWith("/thin")) {
        if (accept.startsWith("text/markdown,")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "text/markdown" }),
            text: async () => "# stub", // < 256 chars
          };
        }
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          text: async () => "<h1>Real thin page</h1>".padEnd(500, " "),
        };
      }
      if (url.endsWith("/lying")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/markdown" }),
          text: async () => "<!doctype html><html>".padEnd(500, " "),
        };
      }
      throw new Error(`unexpected url: ${url}`);
    });
    vi.stubGlobal("fetch", mockFetch);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const src = new DocSource({
        name: "fallback-count-test",
        type: "http",
        format: "html",
        url: "https://example.com/",
        urls: [
          "https://example.com/good",
          "https://example.com/openapi",
          "https://example.com/thin",
          "https://example.com/lying",
        ],
      });
      const set = await ingestor.ingest(src, tmpDir);
      expect(set.size).toBe(4);
    } finally {
      console.log = origLog;
    }

    const stats = logs.find((l) => l.includes("[fallback-count-test]") && l.includes("negotiated"));
    expect(stats).toBeDefined();
    expect(stats).toContain("1/4");
    expect(stats).toContain("1 via HTML fallback (404)");
    expect(stats).toContain("1 via HTML fallback (thin body)");
    expect(stats).toContain("1 via HTML fallback (lying CT)");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("skips broken-server fallback when signal is already aborted", async () => {
    // If the caller aborts between the initial 404 response and the
    // fallback decision, we should not waste a fetch attempt.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const ctrl = new AbortController();
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Trigger abort immediately after the first response is decided.
        ctrl.abort(new Error("source deadline exceeded"));
        return { ok: false, status: 404 };
      }
      // Should never reach here — abort should prevent the fallback.
      return { ok: false, status: 404 };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "abort-fallback-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: ["https://example.com/page"],
    });

    // The page fetch fails with 404 (no fallback fires because of abort),
    // so this single page is recorded as an error. With only one URL, the
    // ingestor throws "all fetches failed".
    await expect(ingestor.ingest(src, tmpDir, ctrl.signal)).rejects.toThrow();
    // Exactly one fetch: the initial markdown attempt. No fallback retry.
    expect(callCount).toBe(1);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("does NOT send Accept: text/markdown on llms.txt discovery", async () => {
    // Same regression guard for the llms-txt discovery path.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    const llmsTxt = `# Docs
- [Intro](https://example.com/intro)
`;
    const calls: Array<{ url: string; accept?: string }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const headers = (init.headers as Record<string, string>) ?? {};
      calls.push({ url, accept: headers.Accept });
      if (url.endsWith("llms.txt")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "text/plain" }),
          text: async () => llmsTxt,
        };
      }
      return {
        ok: true,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<h1>Page</h1>",
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const src = new DocSource({
      name: "llms-discovery-accept-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      discovery: "llms-txt",
      discoveryUrl: "https://example.com/llms.txt",
    });

    await ingestor.ingest(src, tmpDir);

    const llmsCall = calls.find((c) => c.url.endsWith("llms.txt"));
    expect(llmsCall).toBeDefined();
    expect(llmsCall!.accept).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });

  // ─── AbortSignal handling (existing test) ──────────────────────────

  it("aborts in-flight fetches when signal is triggered between batches", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "docs-ssh-http-"));

    // Many URLs so fetch loop spans multiple CONCURRENCY=15 batches.
    const urls: string[] = [];
    for (let i = 0; i < 50; i++) urls.push(`https://example.com/p${i}.html`);

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      // Slow fetch so the abort fires before the first batch finishes.
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, text: async () => "<h1>p</h1>" };
    });
    vi.stubGlobal("fetch", mockFetch);

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error("source deadline exceeded")), 30);

    const src = new DocSource({
      name: "abort-test",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls,
    });

    await expect(ingestor.ingest(src, tmpDir, ctrl.signal)).rejects.toThrow(/abort/i);
    // First batch (15) may complete; subsequent batches must NOT all run.
    expect(fetchCount).toBeLessThan(urls.length);

    await fs.rm(tmpDir, { recursive: true });
  });
});
