import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DocFile } from "../domain/DocFile.js";
import { DocSet, type NegotiationStats } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource } from "../domain/DocSource.js";
import { unzipSync } from "fflate";
import { splitLlmsFull } from "./llms-splitter.js";
import { splitTexinfo } from "./info-splitter.js";
import { convertOpenApiToMarkdown } from "./openapi-converter.js";
import { collectIncidentCodes, incidentToMarkdown } from "./statuspage-converter.js";
import { walkDir } from "../shared/walkDir.js";
import {
  BULK_TIMEOUT,
  CONCURRENCY,
  MAX_RETRIES,
  fetchWithRetry,
} from "./http-client.js";
import { discover } from "./discovery/index.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

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
  | "fallback404" // 404/406 with markdown Accept → recovered via text/html
  | "fallbackThin" // markdown body suspiciously thin → swapped to text/html
  | "fallbackLyingCt"; // Content-Type said markdown but body was HTML

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
      outcome = "fallback404";
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
    outcome = "fallbackLyingCt";
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
            outcome: "fallbackThin",
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
    if (source.discovery === "texinfo" && source.discoveryUrl) {
      return this.ingestFromTexinfo(source, signal);
    }
    if (source.discovery === "llms-full" && source.discoveryUrl) {
      return this.ingestFromLlmsFull(source, signal);
    }
    if (source.discovery === "openapi" && source.discoveryUrl) {
      return this.ingestFromOpenApi(source, signal);
    }
    if (source.discovery === "statuspage") {
      return this.ingestFromStatuspage(source, signal);
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
      fallback404: 0,
      fallbackThin: 0,
      fallbackLyingCt: 0,
    };
    let totalTokens = 0;

    // Per-source override lets rate-limit-prone large scrapes (e.g.
    // cloudflare-blog) throttle below the global 15-wide default so the
    // upstream's bot / rate limiter doesn't collapse the source to zero.
    const concurrency =
      source.pageConcurrency && source.pageConcurrency > 0 ? source.pageConcurrency : CONCURRENCY;
    for (let i = 0; i < urls.length; i += concurrency) {
      // Bail out between batches if the caller aborted (e.g. source
      // deadline expired). Saves concurrency × ~30s of wasted fetches.
      if (signal?.aborted) {
        throw new Error(`fetch aborted: ${signal.reason ?? "deadline exceeded"}`);
      }
      const batch = urls.slice(i, i + concurrency);
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

    // `outcomes` (Record<FetchOutcome, number>) is structurally identical
    // to NegotiationStats sans `totalTokens` — keep them in lockstep so
    // there's no manual rename layer to drift.
    const negotiation: NegotiationStats = { ...outcomes, totalTokens };

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

  // ─── GNU info (texinfo manual) ────────────────────────────

  /**
   * Download a GNU info manual archive (e.g. `mysql-8.4.info.zip` from
   * downloads.mysql.com) and split it into per-node markdown. This is
   * the only mirror-able representation of the MySQL Reference Manual:
   * a single durable archive, no page-by-page HTML scraping.
   *
   * fflate (pure JS) handles the unzip so dev and the Alpine fetcher
   * stage behave identically without a system `unzip` dependency.
   */
  private async ingestFromTexinfo(source: DocSource, signal?: AbortSignal): Promise<DocSet> {
    console.log(`  [${source.name}] downloading info archive…`);
    const res = await fetchWithRetry(source.discoveryUrl!, MAX_RETRIES, BULK_TIMEOUT, signal);
    if (!res.ok) {
      throw new Error(`Failed to fetch info archive: HTTP ${res.status}`);
    }
    const zipBytes = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(zipBytes);
    // Pick the single `.info` entry (the archive contains exactly one).
    const infoName = Object.keys(entries).find((n) => n.endsWith(".info"));
    if (!infoName) {
      throw new Error(
        `info archive contained no .info file (entries: ${Object.keys(entries).join(", ")})`,
      );
    }
    const content = Buffer.from(entries[infoName]).toString("utf-8");
    console.log(`  [${source.name}] info: ${(content.length / 1024 / 1024).toFixed(1)} MB`);

    const files = new Map<string, DocFile>();
    const pages = splitTexinfo(content);
    for (const [filePath, pageContent] of pages) {
      if (source.urlPattern && !new RegExp(source.urlPattern).test(filePath)) continue;
      if (source.urlExclude && new RegExp(source.urlExclude).test(filePath)) continue;
      files.set(filePath, new DocFile(filePath, pageContent));
    }

    console.log(`  [${source.name}] split into ${files.size} pages`);
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

  // ─── Statuspage (Atlassian) ─────────────────────────────────────────

  private async ingestFromStatuspage(source: DocSource, signal?: AbortSignal): Promise<DocSet> {
    const base = source.url.replace(/\/$/, "");
    const fetchJson = async (url: string): Promise<unknown> => {
      const res = await fetchWithRetry(url, MAX_RETRIES, BULK_TIMEOUT, signal);
      if (!res.ok) throw new Error(`Statuspage fetch failed: HTTP ${res.status} for ${url}`);
      return res.json();
    };

    console.log(`  [${source.name}] paginating history.json...`);
    const codes = await collectIncidentCodes(base, fetchJson);
    console.log(`  [${source.name}] discovered ${codes.length} incident codes`);
    if (codes.length === 0) {
      throw new Error(
        `statuspage discovery returned 0 incidents for ${source.name} (${base}/history.json) - upstream format may have changed`,
      );
    }

    const files = new Map<string, DocFile>();
    const errors: string[] = [];
    const concurrency =
      source.pageConcurrency && source.pageConcurrency > 0 ? source.pageConcurrency : CONCURRENCY;
    for (let i = 0; i < codes.length; i += concurrency) {
      if (signal?.aborted) {
        throw new Error(`fetch aborted: ${signal.reason ?? "deadline exceeded"}`);
      }
      const batch = codes.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (code) => {
          const incident = await fetchJson(`${base}/incidents/${code}.json`);
          return incidentToMarkdown(incident as never, code, base);
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          files.set(r.value.path, new DocFile(r.value.path, r.value.content));
        } else {
          errors.push(r.reason?.message ?? String(r.reason));
        }
      }
    }

    if (files.size === 0) {
      throw new Error(`HttpIngestor: all incident fetches failed. First error: ${errors[0]}`);
    }
    if (errors.length > 0) {
      console.warn(`  [${source.name}] ${errors.length} incidents failed (${files.size} succeeded)`);
    }
    console.log(`  [${source.name}] converted to ${files.size} markdown files`);
    return new DocSet(source, files, new Date());
  }
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
  const fb404 = outcomes.fallback404;
  const fbThin = outcomes.fallbackThin;
  const fbLying = outcomes.fallbackLyingCt;
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


