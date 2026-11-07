/**
 * URL-discovery dispatcher.
 *
 * Each `DiscoveryMethod` corresponds to one module under this dir.
 * `discover()` chooses the right one and returns the flat URL list
 * that HttpIngestor then filters, dedupes, and fetches.
 *
 * Bulk-fetch methods (`tarball`, `llms-full`, `openapi`) are not
 * URL-discovery — they return files directly — and are handled inline
 * inside HttpIngestor.
 */
import type { DocSource } from "../../domain/DocSource.js";
import { discoverFromSitemap, discoverFromSitemapIndex } from "./sitemap.js";
import { discoverFromToc } from "./toc.js";
import { discoverFromMediaWiki } from "./mediawiki.js";
import { discoverFromLlmsIndex, discoverFromLlmsTxt } from "./llms.js";
import { discoverFromRss } from "./rss.js";
import { discoverFromDokuWiki } from "./dokuwiki.js";
import { discoverFromMsLearnToc } from "./mslearn.js";

export async function discover(source: DocSource): Promise<string[]> {
  const { discovery, discoveryUrl, url: baseUrl } = source;
  if (!discoveryUrl) return [];

  switch (discovery) {
    case "sitemap":
      return discoverFromSitemap(discoveryUrl, source.urlPattern);
    case "sitemap-index":
      return discoverFromSitemapIndex(discoveryUrl, source.urlPattern);
    case "toc": {
      // Space-separated toc pages are crawled one after another (pyvista).
      const found = new Set<string>();
      for (const tocUrl of discoveryUrl.split(/\s+/).filter(Boolean)) {
        for (const u of await discoverFromToc(tocUrl, baseUrl, source.tocDepth)) found.add(u);
      }
      return [...found];
    }
    case "mediawiki":
      return discoverFromMediaWiki(discoveryUrl, baseUrl);
    case "llms-index":
      return discoverFromLlmsIndex(discoveryUrl, source.urlPattern);
    case "llms-txt":
      return discoverFromLlmsTxt(discoveryUrl);
    case "rss":
      return discoverFromRss(discoveryUrl);
    case "dokuwiki":
      return discoverFromDokuWiki(discoveryUrl, baseUrl, source.urlExclude);
    case "mslearn":
      return discoverFromMsLearnToc(discoveryUrl, baseUrl);
    default:
      return [];
  }
}
