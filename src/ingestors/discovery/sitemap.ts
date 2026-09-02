/**
 * sitemap / sitemap-index discovery.
 *
 * Auto-detects sitemapindex elements inside a `sitemap` URL and
 * transparently delegates to the index path, so misconfigured sources
 * still work.
 */
import { BULK_RETRIES, CONCURRENCY, fetchWithRetry } from "../http-client.js";
import { extractLocs, resolveLocs } from "./sitemap-utils.js";

export async function discoverFromSitemap(sitemapUrl: string, urlPattern?: string): Promise<string[]> {
  const res = await fetchWithRetry(sitemapUrl, BULK_RETRIES);
  if (!res.ok) throw new Error(`Failed to fetch sitemap ${sitemapUrl}: HTTP ${res.status}`);
  const xml = await res.text();

  // Auto-detect: if this is actually a sitemapindex, delegate transparently
  if (xml.includes("<sitemapindex") || xml.includes("</sitemapindex>")) {
    console.log(`  [auto-detect] ${sitemapUrl} is a sitemapindex, not a sitemap`);
    return discoverFromSitemapIndex(sitemapUrl, urlPattern);
  }

  return resolveLocs(extractLocs(xml), sitemapUrl);
}

export async function discoverFromSitemapIndex(
  indexUrl: string,
  urlPattern?: string,
): Promise<string[]> {
  const res = await fetchWithRetry(indexUrl, BULK_RETRIES);
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
