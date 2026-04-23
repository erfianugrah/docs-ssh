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
});
