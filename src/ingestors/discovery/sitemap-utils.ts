/**
 * Tiny sitemap XML helpers shared by sitemap / sitemap-index discovery.
 *
 * Regex-based on purpose: sitemap XML is mechanically generated and
 * highly uniform across the upstreams we consume. A real XML parser
 * would be more defensive but also a new dep; if a real-world sitemap
 * trips these patterns, swap in fast-xml-parser at that point.
 */

/** Extract every `<loc>...</loc>` URL from a sitemap body, decoding common XML entities. */
export function extractLocs(xml: string): string[] {
  const locRegex = /<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/g;
  const urls: string[] = [];
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
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
export function resolveLocs(urls: string[], baseUrl: string): string[] {
  return urls.map((u) => (u.startsWith("http") ? u : new URL(u, baseUrl).href));
}
