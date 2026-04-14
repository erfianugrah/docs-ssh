import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DocFile } from "../domain/DocFile.js";
import { DocSet } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource, DiscoveryMethod } from "../domain/DocSource.js";
import { splitLlmsFull } from "./llms-splitter.js";
import { convertOpenApiToMarkdown } from "./openapi-converter.js";
import { walkDir } from "../shared/walkDir.js";

const CONCURRENCY = 15;
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const UA = "docs-ssh/0.8 (doc-fetcher; +https://github.com/erfianugrah/docs-ssh)";
const MAX_RETRIES = 2;

/** Fetch with User-Agent header and retry on transient/network errors. */
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok || attempt === retries) return res;
      // Retry on 5xx and 413/429 (CDN rate-limit), not on 404 etc.
      if (res.status < 500 && res.status !== 413 && res.status !== 429) return res;
      const delay = 1000 * 2 ** attempt;
      console.warn(`  [retry] ${url} → HTTP ${res.status}, waiting ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const delay = 1000 * 2 ** attempt;
      console.warn(`  [retry] ${url} → ${err instanceof Error ? err.message : err}, waiting ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Ingestor for HTTP doc sources.
 * Supports multiple fetch/discovery methods — see DiscoveryMethod type.
 */
export class HttpIngestor implements DocIngestor {
  readonly name = "HttpIngestor";

  supports(source: DocSource): boolean {
    return source.type === "http";
  }

  async ingest(source: DocSource, workDir: string): Promise<DocSet> {
    // Tarball and llms-full are bulk fetches that return files directly
    if (source.discovery === "tarball" && source.discoveryUrl) {
      return this.ingestFromTarball(source, workDir);
    }
    if (source.discovery === "llms-full" && source.discoveryUrl) {
      return this.ingestFromLlmsFull(source);
    }
    if (source.discovery === "openapi" && source.discoveryUrl) {
      return this.ingestFromOpenApi(source);
    }

    // Everything else is URL-based: discover URLs, filter, fetch each page
    let urls: string[];

    if (source.urls.length > 0) {
      urls = [...source.urls];
    } else if (source.discovery !== "none" && source.discoveryUrl) {
      urls = await discover(source);
      console.log(`  [${source.name}] raw discovery: ${urls.length} URLs`);
    } else {
      urls = [source.url];
    }

    // Apply include filter
    if (source.urlPattern) {
      const re = new RegExp(source.urlPattern);
      urls = urls.filter((u) => re.test(u));
    }

    // Apply exclude filter
    if (source.urlExclude) {
      const re = new RegExp(source.urlExclude);
      urls = urls.filter((u) => !re.test(u));
    }

    // Append suffix
    if (source.urlSuffix) {
      urls = urls.map((u) => u.replace(/\/$/, "") + source.urlSuffix!);
    }

    // Deduplicate
    urls = [...new Set(urls)];

    console.log(`  [${source.name}] fetching ${urls.length} pages…`);

    const files = new Map<string, DocFile>();
    const errors: string[] = [];

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const res = await fetchWithRetry(url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${url}`);
          }
          const content = await res.text();
          const filePath = urlToPath(url, source.url);
          return new DocFile(filePath, content);
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          files.set(result.value.path, result.value);
        } else {
          errors.push(result.reason?.message ?? String(result.reason));
        }
      }
    }

    if (files.size === 0 && errors.length > 0) {
      throw new Error(`HttpIngestor: all fetches failed. First error: ${errors[0]}`);
    }

    if (errors.length > 0) {
      console.warn(`  [${source.name}] ${errors.length} pages failed (${files.size} succeeded)`);
    }

    return new DocSet(source, files, new Date());
  }

  // ─── Tarball ────────────────────────────────────────────────────────

  private async ingestFromTarball(source: DocSource, workDir: string): Promise<DocSet> {
    const extractDir = path.join(workDir, `${source.name}-tarball`);
    await fs.mkdir(extractDir, { recursive: true });

    console.log(`  [${source.name}] downloading tarball…`);
    // Download to a temp file first, then extract — avoids shell injection
    // from interpolating URLs into a shell pipeline.
    const tarballPath = path.join(workDir, `${source.name}.tar.gz`);
    const res = await fetchWithRetry(source.discoveryUrl!);
    if (!res.ok) {
      throw new Error(`Failed to fetch tarball: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tarballPath, buffer);

    execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
      stdio: "pipe",
      timeout: 120_000,
    });

    // Clean up the temp tarball
    await fs.rm(tarballPath, { force: true });

    const files = new Map<string, DocFile>();
    await walkDir(extractDir, extractDir, files, { extensions: MARKDOWN_EXTENSIONS });

    console.log(`  [${source.name}] extracted ${files.size} files from tarball`);
    return new DocSet(source, files, new Date());
  }

  // ─── llms-full.txt ─────────────────────────────────────────────────

  private async ingestFromLlmsFull(source: DocSource): Promise<DocSet> {
    console.log(`  [${source.name}] downloading llms-full.txt…`);
    const res = await fetchWithRetry(source.discoveryUrl!);
    if (!res.ok) {
      throw new Error(`Failed to fetch llms-full.txt: HTTP ${res.status}`);
    }
    const content = await res.text();
    console.log(`  [${source.name}] llms-full.txt: ${(content.length / 1024 / 1024).toFixed(1)} MB`);

    // Split into per-page files using the separator pattern
    const files = new Map<string, DocFile>();
    const pages = splitLlmsFull(content, source.url);

    for (const [filePath, pageContent] of pages) {
      // Apply include/exclude filters
      if (source.urlPattern && !new RegExp(source.urlPattern).test(filePath)) continue;
      if (source.urlExclude && new RegExp(source.urlExclude).test(filePath)) continue;
      files.set(filePath, new DocFile(filePath, pageContent));
    }

    console.log(`  [${source.name}] split into ${files.size} pages`);
    return new DocSet(source, files, new Date());
  }
  // ─── OpenAPI spec ───────────────────────────────────────────────────

  private async ingestFromOpenApi(source: DocSource): Promise<DocSet> {
    console.log(`  [${source.name}] downloading OpenAPI spec…`);
    const res = await fetchWithRetry(source.discoveryUrl!);
    if (!res.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: HTTP ${res.status}`);
    }
    const raw = await res.text();
    console.log(`  [${source.name}] spec: ${(raw.length / 1024).toFixed(0)} KB`);

    const specFiles = convertOpenApiToMarkdown(raw, source.name);
    const files = new Map<string, DocFile>();
    for (const sf of specFiles) {
      files.set(sf.path, new DocFile(sf.path, sf.content));
    }

    console.log(`  [${source.name}] converted to ${files.size} markdown files`);
    return new DocSet(source, files, new Date());
  }
}

// ─── Discovery (URL-based methods) ──────────────────────────────────

async function discover(source: DocSource): Promise<string[]> {
  const { discovery, discoveryUrl, url: baseUrl } = source;
  if (!discoveryUrl) return [];

  switch (discovery) {
    case "sitemap":
      return discoverFromSitemap(discoveryUrl);
    case "sitemap-index":
      return discoverFromSitemapIndex(discoveryUrl, source.urlPattern);
    case "toc":
      return discoverFromToc(discoveryUrl, baseUrl);
    case "llms-index":
      return discoverFromLlmsIndex(discoveryUrl, source.urlPattern);
    case "llms-txt":
      return discoverFromLlmsTxt(discoveryUrl);
    case "rss":
      return discoverFromRss(discoveryUrl);
    default:
      return [];
  }
}

async function discoverFromSitemap(sitemapUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(sitemapUrl);
  if (!res.ok) throw new Error(`Failed to fetch sitemap ${sitemapUrl}: HTTP ${res.status}`);
  return resolveLocs(extractLocs(await res.text()), sitemapUrl);
}

async function discoverFromSitemapIndex(
  indexUrl: string,
  urlPattern?: string,
): Promise<string[]> {
  const res = await fetchWithRetry(indexUrl);
  if (!res.ok) throw new Error(`Failed to fetch sitemap index ${indexUrl}: HTTP ${res.status}`);
  let childUrls = resolveLocs(extractLocs(await res.text()), indexUrl);

  // Pre-filter child sitemaps using the alternation group from urlPattern.
  // Only apply if the filter actually matches some URLs (skip for generic
  // sitemap names like sitemap_12_of_180.xml that don't contain keywords).
  if (urlPattern) {
    const altMatch = urlPattern.match(/\(([^)]+)\)/);
    if (altMatch) {
      const keywords = altMatch[1].split("|");
      const filtered = childUrls.filter((u) =>
        keywords.some((kw) => u.toLowerCase().includes(kw.toLowerCase())),
      );
      if (filtered.length > 0) {
        childUrls = filtered;
      }
    }
  }

  console.log(`  sitemap-index: ${childUrls.length} child sitemaps to fetch`);

  const allUrls: string[] = [];
  for (let i = 0; i < childUrls.length; i += CONCURRENCY) {
    const batch = childUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const r = await fetchWithRetry(url);
        if (!r.ok) return [];
        return resolveLocs(extractLocs(await r.text()), url);
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") allUrls.push(...result.value);
    }
  }

  return allUrls;
}

async function discoverFromToc(tocUrl: string, baseUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(tocUrl);
  if (!res.ok) throw new Error(`Failed to fetch TOC ${tocUrl}: HTTP ${res.status}`);
  const html = await res.text();

  const hrefRegex = /href="([^"#]*\.html)[^"]*"/g;
  const urls = new Set<string>();
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1];
    if (!href.startsWith("http")) {
      href = new URL(href, tocUrl).href;
    }
    if (href.startsWith(baseUrl)) {
      urls.add(href);
    }
  }

  return [...urls];
}

/**
 * Parses a top-level llms.txt to find per-service llms.txt URLs,
 * then fetches each service's llms.txt and extracts page URLs.
 */
async function discoverFromLlmsIndex(
  indexUrl: string,
  urlPattern?: string,
): Promise<string[]> {
  const res = await fetchWithRetry(indexUrl);
  if (!res.ok) throw new Error(`Failed to fetch llms index ${indexUrl}: HTTP ${res.status}`);
  const text = await res.text();

  // Extract all URLs from the index
  const urlRegex = /https?:\/\/[^\s)>]+/g;
  const allLinks = text.match(urlRegex) ?? [];

  // Find child llms.txt URLs
  let childLlmsUrls = allLinks.filter((u) => u.endsWith("/llms.txt") && u !== indexUrl);

  // Pre-filter by urlPattern
  if (urlPattern) {
    const altMatch = urlPattern.match(/\(([^)]+)\)/);
    if (altMatch) {
      const keywords = altMatch[1].split("|");
      childLlmsUrls = childLlmsUrls.filter((u) =>
        keywords.some((kw) => u.toLowerCase().includes(kw.toLowerCase())),
      );
    }
  }

  console.log(`  llms-index: ${childLlmsUrls.length} child llms.txt files to fetch`);

  // Fetch each child llms.txt and extract page URLs from them
  const allUrls: string[] = [];
  for (let i = 0; i < childLlmsUrls.length; i += CONCURRENCY) {
    const batch = childLlmsUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const r = await fetchWithRetry(url);
        if (!r.ok) return [];
        const childText = await r.text();
        const childLinks = childText.match(urlRegex) ?? [];
        // Return HTML page links (not llms.txt links)
        return childLinks.filter((l) => l.endsWith(".html") && !l.endsWith("/llms.txt"));
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") allUrls.push(...result.value);
    }
  }

  return allUrls;
}

/**
 * Parses a llms.txt file for page URLs and returns them directly.
 * Unlike llms-index (which looks for child llms.txt files), this treats
 * all extracted URLs as pages to fetch.
 */
async function discoverFromLlmsTxt(llmsTxtUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(llmsTxtUrl);
  if (!res.ok) throw new Error(`Failed to fetch llms.txt ${llmsTxtUrl}: HTTP ${res.status}`);
  const text = await res.text();

  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  const allLinks = text.match(urlRegex) ?? [];

  // Return all page URLs (exclude the llms.txt URL itself and other llms*.txt files)
  return allLinks.filter((u) => !u.endsWith("/llms.txt") && !u.endsWith("/llms-full.txt") && u !== llmsTxtUrl);
}

/**
 * Parses an RSS feed for page URLs from <link> elements within <item> blocks.
 */
async function discoverFromRss(rssUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(rssUrl);
  if (!res.ok) throw new Error(`Failed to fetch RSS ${rssUrl}: HTTP ${res.status}`);
  const xml = await res.text();

  // Extract <link> URLs from within <item> blocks only (skip channel <link>)
  const urls: string[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const linkRegex = /<link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?\s*<\/link>/;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const linkMatch = match[1].match(linkRegex);
    if (linkMatch) {
      urls.push(linkMatch[1]);
    }
  }

  return urls;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function extractLocs(xml: string): string[] {
  const locRegex = /<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g;
  const urls: string[] = [];
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    // Decode common XML entities
    const url = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    urls.push(url);
  }
  return urls;
}

/** Resolve relative URLs against a base (sitemaps should use absolute URLs but some don't). */
function resolveLocs(urls: string[], baseUrl: string): string[] {
  return urls.map((u) => (u.startsWith("http") ? u : new URL(u, baseUrl).href));
}

function urlToPath(url: string, baseUrl: string): string {
  let relative = url;
  if (relative.startsWith(baseUrl)) {
    relative = relative.slice(baseUrl.length);
  }
  relative = relative.replace(/^\/+/, "").split("?")[0];
  if (!relative || relative.endsWith("/")) {
    relative = relative + "index.html";
  }
  if (!relative.endsWith(".md") && !relative.endsWith(".html")) {
    relative = relative + ".md";
  }
  return relative;
}


