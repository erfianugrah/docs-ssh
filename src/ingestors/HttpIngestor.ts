import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DocFile } from "../domain/DocFile.js";
import { DocSet, type NegotiationStats } from "../domain/DocSet.js";
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
 * Accept header for page fetches. Per RFC 7231 §5.3.2, the q-value
 * fallback ensures spec-compliant servers return HTML when markdown
 * isn't available — single round trip in both cases. Non-compliant
 * servers ignore Accept and return HTML; we detect via Content-Type.
 *
 * Reference: https://acceptmarkdown.com/ and Cloudflare's
 * "Markdown for Agents" (developers.cloudflare.com/fundamentals/
 * reference/markdown-for-agents/).
 */
const PAGE_ACCEPT = "text/markdown, text/html;q=0.9";

/**
 * Below this length threshold a markdown response is treated as a
 * suspected over-stripped page — we retry forcing text/html. The unit
 * is JS string length (UTF-16 code units), not UTF-8 bytes; for ASCII
 * they are equal, for CJK content the threshold is effectively half
 * as restrictive (which is fine — short CJK pages still have ASCII
 * structure like `# `, `[…](…)`, code fences).
 *
 * Empirical floor: real markdown pages observed in probes were 2.2KB+
 * (~2.2k chars) even for stub-like index pages.
 */
const MIN_MARKDOWN_BODY = 256;

/**
 * Content-Type prefixes accepted as markdown. RFC 7763 standardises
 * only `text/markdown`. Cloudflare's "Markdown for Agents" uses that
 * form. `text/x-markdown` is the de facto pre-RFC variant. Some less
 * compliant origins emit `application/markdown` — honour it too;
 * downstream parsers care about body shape, not the bikeshed.
 *
 * Compared with `.startsWith()` after `toLowerCase()`, so trailing
 * parameters (`; charset=utf-8`) and capitalisation are handled.
 */
const MARKDOWN_CT_PREFIXES = [
  "text/markdown",
  "text/x-markdown",
  "application/markdown",
];

/**
 * Heuristic check: does the response body look like HTML, even though
 * the Content-Type header claims markdown? Some origins mislabel —
 * the only signal we can fall back to is content shape. Checks the
 * first ~200 chars (after trim) for an HTML preamble. False negatives
 * are acceptable (worst case: Turndown runs unnecessarily on markdown,
 * skipped by the preNormalised flag); false positives would only fire
 * on markdown documents whose first non-whitespace bytes spell out
 * `<!doctype`, `<html`, `<head`, or `<body` — vanishingly unlikely
 * since `<` is rare unescaped in markdown source.
 */
function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body")
  );
}

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
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return retryWithBackoff(
    async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...(extraHeaders ?? {}) },
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
 * Fetch a content page with markdown content negotiation.
 *
 * Sends `Accept: text/markdown, text/html;q=0.9` and sniffs
 * `Content-Type` on the response. Routes the body to one of two
 * pipeline branches:
 *
 *   - `preNormalised: true`  — origin honoured Accept and returned
 *     `text/markdown`. Caller writes a `.md` file flagged so Pass 1
 *     of normalisation (format converters) is skipped.
 *
 *   - `preNormalised: false` — origin returned HTML (most common
 *     today). Existing pipeline runs HtmlNormaliser → Turndown.
 *
 * Defensive fallback: if a markdown response is suspiciously thin
 * (likely upstream stripped the page too aggressively), retry once
 * with `Accept: text/html` and use the HTML body if it is materially
 * larger.
 *
 * Throws on final non-2xx (consistent with the original page-fetch
 * loop). Retry/abort behaviour is delegated to fetchWithRetry.
 */
/**
 * Outcome marker used by per-source telemetry. Distinguishes which
 * branch of the negotiation produced the body so the ingester can log
 * adoption rate and fallback usage.
 */
type FetchOutcome =
  | "markdown" // origin honoured Accept and returned text/markdown
  | "html" // origin returned text/html (most common)
  | "html-fallback-404" // 404/406 with markdown Accept → recovered via text/html
  | "html-fallback-thin" // markdown body suspiciously thin → swapped to text/html
  | "html-fallback-lying-ct"; // Content-Type said markdown but body was HTML

interface FetchPageResult {
  body: string;
  preNormalised: boolean;
  outcome: FetchOutcome;
  /** From Cloudflare's `x-markdown-tokens` header, if present. */
  tokens?: number;
}

async function fetchPage(
  url: string,
  signal?: AbortSignal,
): Promise<FetchPageResult> {
  let res = await fetchWithRetry(url, undefined, undefined, signal, {
    Accept: PAGE_ACCEPT,
  });
  let outcome: FetchOutcome = "html";

  // Broken-server fallback: some origins return 404/406 ONLY when the
  // markdown variant is requested, even though the spec requires falling
  // back to HTML via the q-weighted Accept. Verified in the wild on
  // turborepo's /docs/openapi/* pages — they 200 with no Accept header
  // but 404 with `Accept: text/markdown, text/html;q=0.9`. Retry once
  // forcing text/html to recover these pages. Skip when caller aborted —
  // avoids one wasted fetch when the signal fires between the initial
  // response and the fallback decision.
  //
  // No try/catch here — unlike the thin-body fallback below, the initial
  // markdown request did not yield usable content (it was a 404). If the
  // fallback also fails (network error, abort, post-retry 404), there is
  // nothing to return, so the error must propagate to the batch loop and
  // be recorded as a page failure.
  if ((res.status === 404 || res.status === 406) && !signal?.aborted) {
    const retry = await fetchWithRetry(url, undefined, undefined, signal, {
      Accept: "text/html",
    });
    if (retry.ok) {
      res = retry;
      outcome = "html-fallback-404";
    }
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const ct = (res.headers?.get?.("content-type") ?? "").toLowerCase();
  let isMarkdown = MARKDOWN_CT_PREFIXES.some((p) => ct.startsWith(p));
  const body = await res.text();

  // Mislabelled Content-Type sniff: the header says markdown but the
  // body opens with HTML. We can't trust the negotiation in that case —
  // route through the HTML pipeline so Turndown runs. No extra fetch.
  if (isMarkdown && looksLikeHtml(body)) {
    isMarkdown = false;
    outcome = "html-fallback-lying-ct";
  } else if (isMarkdown && outcome === "html") {
    outcome = "markdown";
  }

  // Defensive guard: an origin honoured the Accept header but returned
  // near-empty markdown (over-eager pre-processing strips the body).
  // Retry forcing HTML; only switch if the fallback is materially larger
  // so we don't downgrade legitimately short markdown pages. Skip when
  // aborted (consistent with the broken-server fallback above).
  //
  // try/catch (asymmetric with the 404 fallback above): we already have
  // a successful response — just a thin one. If the HTML fallback fails
  // for any reason (network, abort, post-retry 5xx), we keep the thin
  // markdown rather than losing the page entirely. The "materially
  // larger" check (>2× body length) prevents accidentally swapping in
  // a similarly-thin HTML 404 page when both representations are empty.
  if (isMarkdown && body.length < MIN_MARKDOWN_BODY && !signal?.aborted) {
    try {
      const fallback = await fetchWithRetry(url, undefined, undefined, signal, {
        Accept: "text/html",
      });
      if (fallback.ok) {
        const fallbackBody = await fallback.text();
        if (fallbackBody.length > body.length * 2) {
          return {
            body: fallbackBody,
            preNormalised: false,
            outcome: "html-fallback-thin",
          };
        }
      }
    } catch {
      // Fallback failed — keep the (thin) markdown response.
    }
  }

  // Cloudflare's `Markdown for Agents` annotates responses with the
  // estimated token count of the converted document. Useful for
  // operators tracking content-negotiation adoption.
  const tokenHeader = res.headers?.get?.("x-markdown-tokens");
  const tokens = tokenHeader ? parseInt(tokenHeader, 10) : NaN;

  return {
    body,
    preNormalised: isMarkdown,
    outcome,
    tokens: Number.isFinite(tokens) ? tokens : undefined,
  };
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
    // Per-source content-negotiation telemetry. Aggregated and logged
    // once at the end of the fetch so operators can see adoption rate
    // and which fallbacks (if any) fired.
    const outcomes: Record<FetchOutcome, number> = {
      markdown: 0,
      html: 0,
      "html-fallback-404": 0,
      "html-fallback-thin": 0,
      "html-fallback-lying-ct": 0,
    };
    let totalTokens = 0;

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      // Bail out between batches if the caller aborted (e.g. source
      // deadline expired). Saves CONCURRENCY × ~30s of wasted fetches.
      if (signal?.aborted) {
        throw new Error(`fetch aborted: ${signal.reason ?? "deadline exceeded"}`);
      }
      const batch = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const { body, preNormalised, outcome, tokens } = await fetchPage(url, signal);
          let filePath = urlToPath(url, source.url);
          // urlToPath defaults trailing-slash URLs to `index.html` and
          // strips extensions to `.md`. When we received markdown
          // directly via content negotiation, the `.html` suffix is a
          // lie — the file body is markdown. Mirror what HtmlNormaliser
          // does at the end of Pass 1 (path.replace(/\.html$/, ".md"))
          // so cleanup normalisers (MarkdownCleaner) that gate on
          // file.extension === "md" can match.
          if (preNormalised && filePath.endsWith(".html")) {
            filePath = filePath.replace(/\.html$/, ".md");
          }
          return {
            file: new DocFile(filePath, body, { preNormalised }),
            outcome,
            tokens,
          };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          files.set(result.value.file.path, result.value.file);
          outcomes[result.value.outcome]++;
          if (result.value.tokens) totalTokens += result.value.tokens;
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

    logNegotiationStats(source.name, files.size, outcomes, totalTokens);

    const negotiation: NegotiationStats = {
      markdown: outcomes.markdown,
      html: outcomes.html,
      fallback404: outcomes["html-fallback-404"],
      fallbackThin: outcomes["html-fallback-thin"],
      fallbackLyingCt: outcomes["html-fallback-lying-ct"],
      totalTokens,
    };

    return new DocSet(source, files, new Date(), undefined, negotiation);
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

/**
 * Log content-negotiation telemetry for a source. Stays silent when no
 * markdown was negotiated AND no fallback fired — pure HTML scraping
 * looks the same as before. Otherwise prints adoption rate, average
 * token count (when origin returned `x-markdown-tokens`), and counts
 * for each fallback branch that actually triggered.
 */
function logNegotiationStats(
  sourceName: string,
  totalSuccess: number,
  outcomes: Record<FetchOutcome, number>,
  totalTokens: number,
): void {
  const md = outcomes.markdown;
  const fb404 = outcomes["html-fallback-404"];
  const fbThin = outcomes["html-fallback-thin"];
  const fbLying = outcomes["html-fallback-lying-ct"];
  const anyFallback = fb404 + fbThin + fbLying;

  // Stay quiet when there's nothing interesting to report — keeps the
  // build log readable for the majority of sources that don't negotiate.
  if (md === 0 && anyFallback === 0) return;

  const parts: string[] = [];
  if (md > 0) {
    const pct = Math.round((md / totalSuccess) * 100);
    let chunk = `negotiated markdown for ${md}/${totalSuccess} pages (${pct}%)`;
    if (totalTokens > 0) {
      chunk += ` ~${Math.round(totalTokens / md)} tokens/page`;
    }
    parts.push(chunk);
  }
  if (fb404 > 0) parts.push(`${fb404} via HTML fallback (404)`);
  if (fbThin > 0) parts.push(`${fbThin} via HTML fallback (thin body)`);
  if (fbLying > 0) parts.push(`${fbLying} via HTML fallback (lying CT)`);

  console.log(`  [${sourceName}] ${parts.join(", ")}`);
}


