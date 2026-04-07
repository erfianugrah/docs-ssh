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

  it("does not retry on 404", async () => {
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
    // 404 is not retried — only called once
    expect(mockFetch).toHaveBeenCalledTimes(1);

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
});
