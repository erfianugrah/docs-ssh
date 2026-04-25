/**
 * Local source-quality audit.
 *
 * For every HTTP source whose ingestion goes through HTML→Markdown
 * conversion (sitemap/toc/llms-index/llms-txt/rss/mediawiki), this
 * script:
 *
 *   1. Picks one sample page from the source's discovery output.
 *   2. Fetches it via plain `fetch()` and runs the same Turndown +
 *      `<main>/<article>` extraction the production HtmlNormaliser
 *      uses. Measures bytes of clean markdown produced.
 *   3. Renders the same page in headless Chromium, runs Mozilla
 *      Readability against the resulting DOM, and measures bytes of
 *      clean markdown produced.
 *   4. Classifies the source: KEEP (plain fetch is good), JS (plain is
 *      starved, JS extraction recovers content), or DROP (neither
 *      yields meaningful content).
 *
 * Output: tab-separated table to stdout, with the recommendation per
 * source. Designed to be redirected to a file for later analysis:
 *
 *     pnpm tsx scripts/audit-sources.ts > audit-report.tsv
 *
 * Notes on intent:
 *   - This is an offline diagnostic. It does not modify the live
 *     fetcher.
 *   - Sample size is one URL per source. If the audit shows JS gain,
 *     follow up with a deeper sample before flipping a source's
 *     ingestion strategy.
 *   - HtmlNormaliser's MIN_CONVERSION_RATIO (0.01) is reproduced here
 *     so the "would safety net trigger" column matches production.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { SOURCES } from "../src/application/sources.js";
import type { DocSource } from "../src/domain/DocSource.js";

const MIN_CONVERSION_RATIO = 0.01;
const PAGE_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 30_000;
const UA = "docs-ssh-audit/0.1 (+https://github.com/erfianugrah/docs-ssh)";

type Recommendation = "KEEP" | "JS" | "DROP" | "SKIP" | "ERROR";

interface AuditRow {
  source: string;
  url: string;
  plainBytes: number;
  plainMdBytes: number;
  plainRatio: number;
  plainSafetyNet: boolean;
  jsBytes: number;
  jsMdBytes: number;
  recommendation: Recommendation;
  notes: string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

/** Mirrors HtmlNormaliser pre-processing exactly. */
function htmlToMarkdown(html: string): string {
  const original = html;
  let h = html;
  h = h.replace(/<head[\s\S]*?<\/head>/gi, "");
  h = h.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  h = h.replace(/<header[\s\S]*?<\/header>/gi, "");
  h = h.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");

  const mainMatch = h.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) h = mainMatch[1];

  const md = turndown.turndown(h).trim();
  // Production safety net: keep original HTML if conversion is too lossy.
  if (original.length > 1000 && md.length < original.length * MIN_CONVERSION_RATIO) {
    return ""; // signal: safety net would trigger; no usable markdown
  }
  return md;
}

/** Readability + Turndown — the JS-rendered path. */
function readabilityToMarkdown(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  if (!article || !article.content) return "";
  return turndown.turndown(article.content).trim();
}

async function fetchPlain(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchRendered(ctx: BrowserContext, url: string): Promise<string> {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT_MS });
    return await page.content();
  } finally {
    await page.close();
  }
}

/**
 * Score a candidate sample URL. Higher = more likely to be a real
 * content page (not a homepage / 404 / index).
 */
function urlScore(url: string, baseUrl: string): number {
  let score = 0;
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const segments = path.split("/").filter(Boolean);

  // Homepages / shallow paths score badly.
  score += segments.length * 2;

  // Penalise obvious non-content URLs.
  if (/\b(404|sitemap|robots|favicon|search|login|signup|home|index)\b/i.test(url)) score -= 20;
  if (path === "/" || path === "") score -= 50;
  if (url.endsWith("/")) score -= 3;

  // Prefer URLs with content-suggestive path segments.
  if (/\/(docs?|guide|reference|api|tutorial|how-?to|concept|manual)\b/i.test(url)) score += 10;

  // Slight preference for URLs sharing the base (catches off-domain links).
  try {
    const base = new URL(baseUrl).hostname;
    if (new URL(url).hostname.endsWith(base)) score += 2;
  } catch { /* skip */ }

  return score;
}

function pickBest(candidates: string[], baseUrl: string): string | null {
  if (candidates.length === 0) return null;
  // Take a slice starting a few entries in (skip the typical landing
  // page that's often first), find the highest scorer.
  const offset = Math.min(5, Math.floor(candidates.length / 4));
  const pool = candidates.slice(offset, offset + 50);
  return pool.reduce<{ url: string; score: number } | null>(
    (best, url) => {
      const s = urlScore(url, baseUrl);
      return !best || s > best.score ? { url, score: s } : best;
    },
    null,
  )?.url ?? candidates[offset] ?? candidates[0];
}

/**
 * Pick one sample URL per source. Prefers a content-rich page over the
 * source root (homepages and 404s are common at the top of sitemaps).
 */
async function sampleUrl(source: DocSource): Promise<string | null> {
  // For sources with explicit URLs, use the first.
  if (source.urls.length > 0) return source.urls[0];

  if (!source.discoveryUrl) return null;

  try {
    const res = await fetch(source.discoveryUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const text = await res.text();

    if (source.discovery === "sitemap" || source.discovery === "sitemap-index") {
      // Extract all <loc> entries, score, pick best.
      const re = /<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g;
      const urls: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const u = m[1].trim();
        if (/^https?:/.test(u) && !u.endsWith(".xml")) urls.push(u);
      }
      return pickBest(urls, source.url);
    }
    if (source.discovery === "rss") {
      // Multiple <item><link> entries — pick best.
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      const linkRe = /<link>\s*(https?:\/\/[^<\s]+)\s*<\/link>/;
      const urls: string[] = [];
      let im: RegExpExecArray | null;
      while ((im = itemRe.exec(text)) !== null) {
        const lm = im[1].match(linkRe);
        if (lm?.[1]) urls.push(lm[1]);
      }
      return pickBest(urls, source.url);
    }
    if (source.discovery === "llms-txt" || source.discovery === "llms-index") {
      const re = /https?:\/\/[^\s)>]+\.(?:html|md)/g;
      const urls = (text.match(re) ?? []).filter(
        (u) => !u.endsWith("/llms.txt") && !u.endsWith("/llms-full.txt"),
      );
      return pickBest(urls, source.url);
    }
    if (source.discovery === "toc") {
      // Extract href= attribute values that look like absolute URLs.
      const re = /href="(https?:\/\/[^"]+)"/g;
      const urls: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) urls.push(m[1]);
      return pickBest(urls, source.url);
    }
  } catch {
    return null;
  }
  return null;
}

function classify(row: Omit<AuditRow, "recommendation" | "notes">): {
  recommendation: Recommendation;
  notes: string;
} {
  const plainOk = !row.plainSafetyNet && row.plainMdBytes >= 500;
  const jsOk = row.jsMdBytes >= 500;
  if (plainOk && row.plainMdBytes >= row.jsMdBytes * 0.7) {
    return { recommendation: "KEEP", notes: "plain fetch yields usable markdown" };
  }
  if (!plainOk && jsOk) {
    return { recommendation: "JS", notes: `plain ${row.plainMdBytes}B vs js ${row.jsMdBytes}B — needs JS render` };
  }
  if (!plainOk && !jsOk) {
    return { recommendation: "DROP", notes: "neither path yields content; consider removing source" };
  }
  // plainOk but js gives notably more content
  return { recommendation: "JS", notes: `js produces ${Math.round((row.jsMdBytes / row.plainMdBytes - 1) * 100)}% more content` };
}

async function auditOne(source: DocSource, browser: Browser): Promise<AuditRow> {
  const empty: AuditRow = {
    source: source.name,
    url: "",
    plainBytes: 0,
    plainMdBytes: 0,
    plainRatio: 0,
    plainSafetyNet: false,
    jsBytes: 0,
    jsMdBytes: 0,
    recommendation: "SKIP",
    notes: "",
  };

  // Skip non-HTML formats — they don't go through Turndown.
  if (source.format !== "html") {
    return { ...empty, notes: `format=${source.format} (skip)` };
  }
  // Skip tarball/llms-full bulk — different ingestion path.
  if (source.discovery === "tarball" || source.discovery === "llms-full") {
    return { ...empty, notes: `bulk discovery=${source.discovery} (skip)` };
  }

  const url = await sampleUrl(source);
  if (!url) {
    return { ...empty, notes: "could not derive sample URL" };
  }

  let plainHtml = "";
  try {
    plainHtml = await fetchPlain(url);
  } catch (err) {
    return {
      ...empty,
      url,
      recommendation: "ERROR",
      notes: `plain fetch: ${err instanceof Error ? err.message : err}`,
    };
  }

  const plainMd = htmlToMarkdown(plainHtml);
  const plainSafetyNet = plainHtml.length > 1000 && plainMd === "";
  const plainRatio = plainHtml.length > 0 ? plainMd.length / plainHtml.length : 0;

  let jsHtml = "";
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    try {
      jsHtml = await fetchRendered(ctx, url);
    } finally {
      await ctx.close();
    }
  } catch (err) {
    // JS render failure isn't fatal — fall through with jsBytes=0
    const partial: Omit<AuditRow, "recommendation" | "notes"> = {
      source: source.name,
      url,
      plainBytes: plainHtml.length,
      plainMdBytes: plainMd.length,
      plainRatio,
      plainSafetyNet,
      jsBytes: 0,
      jsMdBytes: 0,
    };
    return {
      ...partial,
      ...classify(partial),
      notes: `js render failed: ${err instanceof Error ? err.message : err}`,
    };
  }

  const jsMd = readabilityToMarkdown(jsHtml, url);

  const partial: Omit<AuditRow, "recommendation" | "notes"> = {
    source: source.name,
    url,
    plainBytes: plainHtml.length,
    plainMdBytes: plainMd.length,
    plainRatio,
    plainSafetyNet,
    jsBytes: jsHtml.length,
    jsMdBytes: jsMd.length,
  };
  return { ...partial, ...classify(partial) };
}

function tsv(row: AuditRow): string {
  const cols = [
    row.source,
    row.recommendation,
    String(row.plainMdBytes),
    String(row.jsMdBytes),
    row.plainSafetyNet ? "Y" : "N",
    String(row.plainBytes),
    String(row.jsBytes),
    row.url,
    row.notes,
  ];
  return cols.join("\t");
}

async function main() {
  console.error(`Auditing ${SOURCES.length} sources…`);
  const browser = await chromium.launch({ headless: true });
  try {
    // Header
    console.log(["source", "rec", "plain_md_B", "js_md_B", "safety_net", "plain_B", "js_B", "url", "notes"].join("\t"));

    // Process serially — Playwright contexts are heavy and parallelism
    // would overwhelm both upstreams and the local box. The audit is a
    // one-shot diagnostic; total wall time is a concern but secondary.
    let i = 0;
    for (const source of SOURCES) {
      i++;
      console.error(`[${i}/${SOURCES.length}] ${source.name}…`);
      try {
        const row = await auditOne(source, browser);
        console.log(tsv(row));
      } catch (err) {
        const errRow: AuditRow = {
          source: source.name,
          url: "",
          plainBytes: 0,
          plainMdBytes: 0,
          plainRatio: 0,
          plainSafetyNet: false,
          jsBytes: 0,
          jsMdBytes: 0,
          recommendation: "ERROR",
          notes: `audit failed: ${err instanceof Error ? err.message : err}`,
        };
        console.log(tsv(errRow));
      }
    }
  } finally {
    await browser.close();
  }
}

await main();
