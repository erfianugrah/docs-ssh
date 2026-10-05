/**
 * Microsoft Learn discovery from its per-section `toc.json` files (the
 * sidebar data every Learn page references via `<meta name="toc_rel">`).
 * Each item may carry a relative `href` and nested `children`/`items`.
 * Used where a Learn doc set's git repo is gone: azure-security-docs went
 * private in 2026-10 (clone asks for credentials), while the pages still
 * answer `Accept: text/markdown` with clean markdown.
 *
 * `discoveryUrl` holds one or more toc.json URLs, space-separated (a doc
 * set like Key Vault splits its sidebar across general/keys/secrets/...).
 * Hrefs resolve against their toc.json; only pages under `baseUrl` are
 * kept, which drops cross-links into the CLI reference, architecture
 * center and external sites.
 */
import { BULK_RETRIES, fetchWithRetry } from "../http-client.js";

interface TocItem {
  href?: string;
  children?: TocItem[];
  items?: TocItem[];
}

function collectHrefs(items: readonly TocItem[] | undefined, out: string[]): void {
  for (const item of items ?? []) {
    if (item.href) out.push(item.href);
    collectHrefs(item.children, out);
    collectHrefs(item.items, out);
  }
}

export async function discoverFromMsLearnToc(discoveryUrl: string, baseUrl: string): Promise<string[]> {
  const tocUrls = discoveryUrl.split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  for (const [i, tocUrl] of tocUrls.entries()) {
    const res = await fetchWithRetry(tocUrl, BULK_RETRIES);
    if (!res.ok) {
      if (i === 0) throw new Error(`Failed to fetch toc.json ${tocUrl}: HTTP ${res.status}`);
      continue;
    }
    const toc = JSON.parse(await res.text()) as { items?: TocItem[] };
    const hrefs: string[] = [];
    collectHrefs(toc.items, hrefs);
    for (const href of hrefs) {
      if (href.startsWith("#")) continue;
      let url: URL;
      try {
        url = new URL(href, tocUrl);
      } catch {
        continue;
      }
      url.hash = "";
      url.search = "";
      if (url.href.startsWith(baseUrl)) found.add(url.href);
    }
  }
  return [...found];
}
