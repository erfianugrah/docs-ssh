/**
 * HTML table-of-contents discovery. Scrapes every `href` from a page,
 * filters to URLs under `baseUrl`, and drops common non-doc extensions.
 *
 * `depth` (default 1) makes it a bounded BFS: depth 1 = the current
 * single-page scrape; depth 2 also visits each discovered page and
 * collects its links (needed for Sphinx sites whose version index only
 * links section index pages, which in turn link the actual pages).
 */
import { BULK_RETRIES, fetchWithRetry } from "../http-client.js";

const SKIP_EXTENSIONS = /\.(css|js|json|xml|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|zip|tar|gz|pdf)$/i;
const MAX_VISITED = 5000;

function extractLinks(html: string, pageUrl: string): string[] {
  const hrefRegex = /href="([^"\s]+)"/gi;
  const urls: string[] = [];
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let href = match[1].split("#")[0];
    if (!href || SKIP_EXTENSIONS.test(href)) continue;
    if (!href.startsWith("http")) {
      try { href = new URL(href, pageUrl).href; } catch { continue; }
    }
    urls.push(href);
  }
  return urls;
}

export async function discoverFromToc(tocUrl: string, baseUrl: string, depth = 1): Promise<string[]> {
  const found = new Set<string>();
  const visited = new Set<string>();
  let frontier = [tocUrl];
  let level = 0;

  while (frontier.length > 0 && level < depth) {
    const next: string[] = [];
    for (const page of frontier) {
      if (visited.has(page) || visited.size >= MAX_VISITED) continue;
      visited.add(page);
      const res = await fetchWithRetry(page, BULK_RETRIES);
      if (!res.ok) {
        if (page === tocUrl) throw new Error(`Failed to fetch TOC ${tocUrl}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      for (const u of extractLinks(html, page)) {
        if (!u.startsWith(baseUrl) || found.has(u)) continue;
        found.add(u);
        next.push(u);
      }
    }
    frontier = next;
    level++;
  }

  return [...found];
}
