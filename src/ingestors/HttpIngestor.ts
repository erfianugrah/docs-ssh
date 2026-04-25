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
import { retryWithBackoff } from "../shared/retry.js";

const CONCURRENCY = 15;
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const UA = "docs-ssh/0.8 (doc-fetcher; +https://github.com/erfianugrah/docs-ssh)";
const MAX_RETRIES = 2;

const REQUEST_TIMEOUT = 30_000; // 30s per page fetch
const BULK_TIMEOUT = 120_000;   // 120s for large single-file downloads (llms-full, tarball, specs)

/**
 * Combine an external AbortSignal with a per-attempt timeout, so a
 * caller can cancel in-flight retries (e.g. UpdateDocSets.withDeadline)
 * without losing the per-fetch timeout safety net.
 */
function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, external]);
  }
  // Pre-Node-20 fallback (not needed today, but cheap to keep).
  const ctrl = new AbortController();
  for (const s of [timeout, external]) {
    if (s.aborted) ctrl.abort(s.reason);
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * Fetch with User-Agent header, per-attempt timeout, and retry on
 * transient failures (network errors, 5xx, 413, 429). Uses exponential
 * backoff with jitter so concurrent failures don't retry in lockstep.
 *
 * A thrown Response (on non-retryable status codes like 404) escapes
 * the retry loop via shouldRetry=false. All other throws and retryable
 * responses are retried.
 *
 * If `signal` is provided, abortion stops both the in-flight fetch
 * and the retry loop (via shouldRetry).
 */
async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
  timeout = REQUEST_TIMEOUT,
  signal?: AbortSignal,
): Promise<Response> {
  return retryWithBackoff(
    async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: combineSignals(timeout, signal),
      });
      // OK responses return directly.
      if (res.ok) return res;
      // Non-retryable 4xx (404, 403, etc.) — return so caller can
      // inspect status. Throwing a special marker so retryWithBackoff
      // doesn't retry, then rethrowing to the caller is overkill;
      // instead we use a sentinel error whose shouldRetry returns false.
      if (res.status < 500 && res.status !== 413 && res.status !== 429) {
        return res;
      }
      // Retryable status — throw so retryWithBackoff can retry.
      throw new RetryableHttpError(`HTTP ${res.status} for ${url}`, res);
    },
    {
      retries,
      // Stop retrying immediately if the caller aborts.
      shouldRetry: () => !signal?.aborted,
      // Honour Retry-After when the upstream provides one (429/503).
      // Falls through to exponential backoff otherwise.
      delayFromError: (err) =>
        err instanceof RetryableHttpError ? err.retryAfterMs : undefined,
      onRetry: (_attempt, err, delay) => {
        const msg = err instanceof Error ? err.message : String(err);
        const hinted =
          err instanceof RetryableHttpError && err.retryAfterMs !== undefined
            ? " (Retry-After honoured)"
            : "";
        console.warn(`  [retry] ${url} → ${msg}, waiting ${Math.round(delay)}ms${hinted}…`);
      },
    },
  ).catch((err: unknown) => {
    // If the last error was a RetryableHttpError (status code), return
    // its Response so the caller can still inspect it. Otherwise rethrow.
    if (err instanceof RetryableHttpError) return err.response;
    throw err;
  });
}

/** Thrown to signal a retryable HTTP status; caller unwraps on final attempt. */
class RetryableHttpError extends Error {
  /** Server-suggested delay (ms), parsed from Retry-After header if present. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    public readonly response: Response,
  ) {
    super(message);
    this.name = "RetryableHttpError";
    // Defensive: mocked Response objects in unit tests may lack a
    // `headers` property. Real `fetch` always provides Headers.
    const header = response.headers?.get?.("retry-after") ?? null;
    this.retryAfterMs = parseRetryAfter(header);
  }
}

/**
 * RFC 7231 §7.1.3 Retry-After is either a non-negative integer
 * (seconds) or an HTTP-date. Returns a delay in milliseconds, or
 * undefined when the header is absent / malformed / in the past.
 *
 * We cap at 5 minutes — any longer and the source-deadline is going
 * to fire anyway, so it's better to fail fast than block the whole
 * batch on a single rate-limited URL.
 */
const RETRY_AFTER_MAX_MS = 5 * 60_000;
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  // Numeric: seconds.
  if (/^\d+$/.test(trimmed)) {
    const ms = parseInt(trimmed, 10) * 1000;
    return Math.min(ms, RETRY_AFTER_MAX_MS);
  }
  // HTTP-date.
  const at = Date.parse(trimmed);
  if (!Number.isNaN(at)) {
    const delta = at - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_MAX_MS);
  }
  return undefined;
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

  async ingest(source: DocSource, workDir: string, signal?: AbortSignal): Promise<DocSet> {
    // Tarball and llms-full are bulk fetches that return files directly
    if (source.discovery === "tarball" && source.discoveryUrl) {
      return this.ingestFromTarball(source, workDir, signal);
    }
    if (source.discovery === "llms-full" && source.discoveryUrl) {
      return this.ingestFromLlmsFull(source, signal);
    }
    if (source.discovery === "openapi" && source.discoveryUrl) {
      return this.ingestFromOpenApi(source, signal);
    }

    // Everything else is URL-based: discover URLs, filter, fetch each page
    let urls: string[];

    if (source.urls.length > 0) {
      urls = [...source.urls];
    } else if (source.discovery !== "none" && source.discoveryUrl) {
      urls = await discover(source);
      console.log(`  [${source.name}] raw discovery: ${urls.length} URLs`);
      // Loud failure when discovery returns nothing. The previous quiet
      // behaviour caused the AWS source to silently drop from 10k+ files
      // to ~0 when upstream switched .html → .md in llms.txt — empty
      // DocSet writes a clean state and freshness keeps stale files.
      // Throwing here makes the source error out so it shows up in the
      // 'N failed' summary instead of pretending success.
      if (urls.length === 0) {
        throw new Error(
          `discovery returned 0 URLs for ${source.name} (method: ${source.discovery}, url: ${source.discoveryUrl}) — upstream format may have changed`,
        );
      }
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
      // Bail out between batches if the caller aborted (e.g. source
      // deadline expired). Saves CONCURRENCY × ~30s of wasted fetches.
      if (signal?.aborted) {
        throw new Error(`fetch aborted: ${signal.reason ?? "deadline exceeded"}`);
      }
      const batch = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const res = await fetchWithRetry(url, undefined, undefined, signal);
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

  private async ingestFromTarball(source: DocSource, workDir: string, signal?: AbortSignal): Promise<DocSet> {
    const extractDir = path.join(workDir, `${source.name}-tarball`);
    await fs.mkdir(extractDir, { recursive: true });

    console.log(`  [${source.name}] downloading tarball…`);
    // Download to a temp file first, then extract — avoids shell injection
    // from interpolating URLs into a shell pipeline.
    const tarballPath = path.join(workDir, `${source.name}.tar.gz`);
    const res = await fetchWithRetry(source.discoveryUrl!, MAX_RETRIES, BULK_TIMEOUT, signal);
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

  private async ingestFromLlmsFull(source: DocSource, signal?: AbortSignal): Promise<DocSet> {
    console.log(`  [${source.name}] downloading llms-full.txt…`);
    const res = await fetchWithRetry(source.discoveryUrl!, MAX_RETRIES, BULK_TIMEOUT, signal);
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

  private async ingestFromOpenApi(source: DocSource, signal?: AbortSignal): Promise<DocSet> {
    console.log(`  [${source.name}] downloading OpenAPI spec…`);
    const res = await fetchWithRetry(source.discoveryUrl!, MAX_RETRIES, BULK_TIMEOUT, signal);
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
      return discoverFromSitemap(discoveryUrl, source.urlPattern);
    case "sitemap-index":
      return discoverFromSitemapIndex(discoveryUrl, source.urlPattern);
    case "toc":
      return discoverFromToc(discoveryUrl, baseUrl);
    case "mediawiki":
      return discoverFromMediaWiki(discoveryUrl, baseUrl);
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

async function discoverFromSitemap(sitemapUrl: string, urlPattern?: string): Promise<string[]> {
  const res = await fetchWithRetry(sitemapUrl);
  if (!res.ok) throw new Error(`Failed to fetch sitemap ${sitemapUrl}: HTTP ${res.status}`);
  const xml = await res.text();

  // Auto-detect: if this is actually a sitemapindex, delegate transparently
  if (xml.includes("<sitemapindex") || xml.includes("</sitemapindex>")) {
    console.log(`  [auto-detect] ${sitemapUrl} is a sitemapindex, not a sitemap`);
    return discoverFromSitemapIndex(sitemapUrl, urlPattern);
  }

  return resolveLocs(extractLocs(xml), sitemapUrl);
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

const SKIP_EXTENSIONS = /\.(css|js|json|xml|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|zip|tar|gz|pdf)$/i;

async function discoverFromToc(tocUrl: string, baseUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(tocUrl);
  if (!res.ok) throw new Error(`Failed to fetch TOC ${tocUrl}: HTTP ${res.status}`);
  const html = await res.text();

  // Match all hrefs (case-insensitive for XHTML/DocBook), strip #fragments
  const hrefRegex = /href="([^"\s]+)"/gi;
  const urls = new Set<string>();
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1].split("#")[0];
    if (!href || SKIP_EXTENSIONS.test(href)) continue;
    if (!href.startsWith("http")) {
      try { href = new URL(href, tocUrl).href; } catch { continue; }
    }
    if (href.startsWith(baseUrl)) {
      urls.add(href);
    }
  }

  return [...urls];
}

/**
 * Enumerates all pages from a MediaWiki API (action=query&list=allpages).
 * Paginates automatically via `apcontinue` tokens.
 * Returns full page URLs like https://wiki.example.org/wiki/PageName.
 */
async function discoverFromMediaWiki(apiUrl: string, baseUrl: string): Promise<string[]> {
  const urls: string[] = [];
  let continueFrom = "";

  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({
      action: "query",
      list: "allpages",
      apnamespace: "0",
      aplimit: "500",
      apfilterredir: "nonredirects",
      format: "json",
    });
    if (continueFrom) params.set("apcontinue", continueFrom);

    const url = `${apiUrl}?${params}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`MediaWiki API error: HTTP ${res.status}`);
    const data = JSON.parse(await res.text());

    for (const page of data.query?.allpages ?? []) {
      const title = page.title.replace(/ /g, "_");
      urls.push(`${baseUrl}${encodeURIComponent(title)}`);
    }

    if (data.continue?.apcontinue) {
      continueFrom = data.continue.apcontinue;
    } else {
      break;
    }
  }

  return urls;
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
        // Page URLs are anything ending in .md or .html and not a
        // sibling llms.txt. AWS migrated from .html to .md in 2026 —
        // we accept both so older mirrors still work.
        return childLinks.filter(
          (l) =>
            (l.endsWith(".md") || l.endsWith(".html")) &&
            !l.endsWith("/llms.txt") &&
            !l.endsWith("/llms-full.txt"),
        );
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
 *
 * Supports both absolute URLs (https://...) and relative paths in markdown
 * links like [Title](/path.md) or [Title](relative.md), resolving them
 * against the llms.txt URL's origin.
 */
async function discoverFromLlmsTxt(llmsTxtUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(llmsTxtUrl);
  if (!res.ok) throw new Error(`Failed to fetch llms.txt ${llmsTxtUrl}: HTTP ${res.status}`);
  const text = await res.text();

  const urls = new Set<string>();

  // Extract absolute URLs
  const absRegex = /https?:\/\/[^\s)>\]]+/g;
  let match;
  while ((match = absRegex.exec(text)) !== null) {
    urls.add(match[0]);
  }

  // Extract relative paths from markdown links: [text](path)
  const mdLinkRegex = /\]\(([^)]+)\)/g;
  const base = new URL(llmsTxtUrl);
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const href = match[1];
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      urls.add(new URL(href, base).href);
    } catch { /* skip malformed */ }
  }

  // Return all page URLs (exclude the llms.txt URL itself and other llms*.txt files)
  return [...urls].filter((u) => !u.endsWith("/llms.txt") && !u.endsWith("/llms-full.txt") && u !== llmsTxtUrl);
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


