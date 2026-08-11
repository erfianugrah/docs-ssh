/**
 * DokuWiki index discovery.
 *
 * DokuWiki's `?do=index` page renders the wiki as an expandable
 * namespace tree: namespace links carry an `idx=<ns>` query param
 * (colon-separated, URL-encoded for nested namespaces), page links are
 * ordinary content URLs. Each `?idx=<ns>` page is server-rendered with
 * that namespace's pages and child namespaces, so a BFS over idx links
 * enumerates the whole wiki. Verified against openwrt.org (clean-URL
 * template) and wiki.freshtomato.org (doku.php PATH_INFO template).
 *
 * `exclude` (the source's urlExclude regex) is also used to prune whole
 * namespaces BEFORE their idx page is fetched: an idx value is turned
 * into a synthetic page path (`${pagePrefix}${ns-with-slashes}/`) and
 * tested against the regex, so language or playground subtrees cost no
 * requests. The regex still applies to final page URLs in HttpIngestor.
 */
import { CONCURRENCY, fetchWithRetry } from "../http-client.js";

const SKIP_EXTENSIONS = /\.(css|js|json|xml|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|zip|tar|gz|pdf)$/i;
// DokuWiki chrome paths that leak from idx-page sidebars when the wiki
// uses clean URLs (pagePrefix is the domain root, e.g. openwrt.org).
const CHROME_PATHS = /\/(lib|_media|_export|_detail)(\/|$)|\/feed\.php$|\/doku\.php$/;
// openwrt's `toh` subtree alone has one namespace per device vendor
// (hundreds), so the cap must clear that with room for the rest.
const MAX_IDX_PAGES = 2_000; // defensive cap on namespace pages visited
const MAX_PAGES = 20_000; // defensive cap on discovered page URLs

export async function discoverFromDokuWiki(
  indexUrl: string,
  pagePrefix: string,
  exclude?: string,
): Promise<string[]> {
  const excludeRe = exclude ? new RegExp(exclude) : undefined;

  const isExcludedNamespace = (idx: string): boolean => {
    if (!excludeRe) return false;
    const nsPath = idx.replaceAll(":", "/");
    return excludeRe.test(`${pagePrefix}${nsPath}/`);
  };

  const pages = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [indexUrl];

  while (queue.length > 0 && visited.size < MAX_IDX_PAGES && pages.size < MAX_PAGES) {
    const batch = queue.splice(0, CONCURRENCY).filter((u) => !visited.has(u));
    if (batch.length === 0) continue;
    for (const u of batch) visited.add(u);

    const results = await Promise.allSettled(
      batch.map(async (u) => {
        const res = await fetchWithRetry(u);
        return res.ok ? { html: await res.text(), base: u } : { html: "", base: u };
      }),
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value.html) continue;
      const { html, base } = result.value;

      const hrefRegex = /href="([^"\s]+)"/gi;
      let match;
      while ((match = hrefRegex.exec(html)) !== null) {
        // DokuWiki emits XHTML-escaped query strings (&amp;)
        const href = match[1].replaceAll("&amp;", "&").split("#")[0];
        if (!href || SKIP_EXTENSIONS.test(href)) continue;

        let abs: URL;
        try {
          abs = new URL(href, base);
        } catch {
          continue;
        }
        abs.hash = "";

        const idx = abs.searchParams.get("idx");
        if (idx !== null) {
          const key = abs.href;
          if (!visited.has(key) && !isExcludedNamespace(idx) && visited.size + queue.length < MAX_IDX_PAGES) {
            queue.push(key);
          }
          continue;
        }

        if (abs.search) continue; // drop ?do= / other action URLs
        if (!abs.href.startsWith(pagePrefix)) continue;
        if (CHROME_PATHS.test(abs.pathname)) continue;
        pages.add(abs.href);
      }
    }
  }

  return [...pages];
}
