/**
 * Sweep all HTML-scraping sources for the turborepo-style bug:
 * pages that 404/406 only when Accept: text/markdown is sent.
 *
 * For each source, samples up to 3 page URLs from its discovery
 * method and probes them twice: with the new weighted Accept header,
 * then with text/html only. Reports any source where adding the
 * markdown preference triggers a non-2xx that text/html doesn't.
 */
import { SOURCES } from "../src/application/sources.js";

const TIMEOUT = 12_000;
const SAMPLE_PER_SOURCE = 8;
const UA = "docs-ssh/0.8 (broken-server-probe)";

interface Issue {
  source: string;
  url: string;
  withMarkdown: string;
  withHtml: string;
}

async function probe(url: string, accept: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const ct = (res.headers.get("content-type") ?? "").split(";")[0];
    return `${res.status} ${ct}`;
  } catch (e) {
    return `err ${e instanceof Error ? e.message.slice(0, 30) : String(e)}`;
  }
}

async function sampleUrlsFromSitemap(sitemapUrl: string, pattern?: string): Promise<string[]> {
  const res = await fetch(sitemapUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  // Quick + dirty <loc> extraction
  const locs: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) locs.push(m[1]);
  const filtered = pattern ? locs.filter((u) => new RegExp(pattern).test(u)) : locs;
  // Uniformly sample across the URL list — biased sampling toward
  // homepage-ish URLs would have missed the turborepo /docs/openapi/*
  // case which only appears deep in the sitemap.
  const unique = [...new Set(filtered)];
  if (unique.length <= SAMPLE_PER_SOURCE) return unique;
  const stride = Math.floor(unique.length / SAMPLE_PER_SOURCE);
  return Array.from({ length: SAMPLE_PER_SOURCE }, (_, i) => unique[i * stride]);
}

async function sampleUrlsFromToc(tocUrl: string, baseUrl: string, pattern?: string, exclude?: string): Promise<string[]> {
  const res = await fetch(tocUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const hrefRe = /href="([^"\s]+)"/gi;
  const urls = new Set<string>();
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let href = m[1].split("#")[0];
    if (!href) continue;
    if (/\.(css|js|json|xml|png|jpe?g|svg|ico|woff2?|pdf)$/i.test(href)) continue;
    if (!href.startsWith("http")) {
      try { href = new URL(href, tocUrl).href; } catch { continue; }
    }
    if (href.startsWith(baseUrl)) urls.add(href);
  }
  let filtered = [...urls];
  if (pattern) filtered = filtered.filter((u) => new RegExp(pattern).test(u));
  if (exclude) filtered = filtered.filter((u) => !new RegExp(exclude).test(u));
  if (filtered.length <= SAMPLE_PER_SOURCE) return filtered;
  const stride = Math.floor(filtered.length / SAMPLE_PER_SOURCE);
  return Array.from({ length: SAMPLE_PER_SOURCE }, (_, i) => filtered[i * stride]);
}

async function sampleUrlsFromLlmsTxt(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return [];
  const text = await res.text();
  const absRe = /https?:\/\/[^\s)>\]]+/g;
  const urls = [...new Set((text.match(absRe) ?? []).filter((u) => !u.endsWith("llms.txt")))];
  return urls.slice(0, SAMPLE_PER_SOURCE);
}

// Filter to HTML-scraping sources we care about
const targets = SOURCES.filter(
  (s) =>
    s.type === "http" &&
    s.format === "html" &&
    (s.discovery === "sitemap" ||
      s.discovery === "sitemap-index" ||
      s.discovery === "toc" ||
      s.discovery === "llms-txt" ||
      s.discovery === "rss" ||
      s.discovery === "mediawiki"),
);

console.log(`Probing ${targets.length} HTML-scraping sources, ${SAMPLE_PER_SOURCE} URLs each\n`);

const issues: Issue[] = [];
const summary: Array<{ source: string; status: string }> = [];

for (const src of targets) {
  if (!src.discoveryUrl) {
    summary.push({ source: src.name, status: "no-discovery" });
    continue;
  }
  let urls: string[] = [];
  try {
    if (src.discovery === "sitemap" || src.discovery === "sitemap-index") {
      urls = await sampleUrlsFromSitemap(src.discoveryUrl, src.urlPattern);
    } else if (src.discovery === "llms-txt") {
      urls = await sampleUrlsFromLlmsTxt(src.discoveryUrl);
    } else if (src.discovery === "toc") {
      urls = await sampleUrlsFromToc(src.discoveryUrl, src.url, src.urlPattern, src.urlExclude);
    } else {
      summary.push({ source: src.name, status: `skip-${src.discovery}` });
      continue;
    }
  } catch (e) {
    summary.push({
      source: src.name,
      status: `discover-err: ${e instanceof Error ? e.message.slice(0, 30) : String(e)}`,
    });
    continue;
  }

  if (urls.length === 0) {
    summary.push({ source: src.name, status: "no-urls" });
    continue;
  }

  let sourceIssues = 0;
  for (const url of urls) {
    const [wm, wh] = await Promise.all([
      probe(url, "text/markdown, text/html;q=0.9"),
      probe(url, "text/html"),
    ]);
    const mdFailed = !wm.startsWith("2");
    const htmlOk = wh.startsWith("2");
    if (mdFailed && htmlOk) {
      issues.push({ source: src.name, url, withMarkdown: wm, withHtml: wh });
      sourceIssues++;
    }
  }
  const sampleResults = urls.length;
  summary.push({
    source: src.name,
    status:
      sourceIssues > 0
        ? `${sourceIssues}/${sampleResults} REGRESS`
        : `${sampleResults}/${sampleResults} ok`,
  });
}

console.log("source                    discovery     status");
console.log("─".repeat(80));
for (const r of summary) {
  const src = targets.find((s) => s.name === r.source);
  console.log(
    `${r.source.padEnd(26)}${(src?.discovery ?? "?").padEnd(15)}${r.status}`,
  );
}

console.log(`\n=== Sources affected by 404-on-markdown bug (${issues.length} URLs) ===`);
for (const i of issues) {
  console.log(`  ${i.source.padEnd(20)} ${i.url}`);
  console.log(`    md:   ${i.withMarkdown}`);
  console.log(`    html: ${i.withHtml}`);
}

console.log(
  `\nResult: ${issues.length > 0 ? "broken-server fallback is REQUIRED" : "fallback is precautionary only"}`,
);
process.exit(0);
