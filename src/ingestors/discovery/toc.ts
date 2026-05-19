/**
 * HTML table-of-contents discovery. Scrapes every `href` from a page,
 * filters to URLs under `baseUrl`, and drops common non-doc extensions.
 */
import { fetchWithRetry } from "../http-client.js";

const SKIP_EXTENSIONS = /\.(css|js|json|xml|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|zip|tar|gz|pdf)$/i;

export async function discoverFromToc(tocUrl: string, baseUrl: string): Promise<string[]> {
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
