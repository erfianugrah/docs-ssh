/**
 * MediaWiki API discovery.
 *
 * Enumerates all pages via action=query&list=allpages, paginating
 * automatically via `apcontinue` tokens. Returns full page URLs like
 * https://wiki.example.org/wiki/PageName.
 *
 * Caps at 20 pagination rounds (10k pages) — defensive against
 * runaway APIs; large wikis we consume have <5k pages.
 */
import { fetchWithRetry } from "../http-client.js";

const MAX_ROUNDS = 20;

export async function discoverFromMediaWiki(apiUrl: string, baseUrl: string): Promise<string[]> {
  const urls: string[] = [];
  let continueFrom = "";

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const params = new URLSearchParams({
      action: "query",
      list: "allpages",
      apnamespace: "0",
      aplimit: "500",
      apfilterredir: "nonredirects",
      format: "json",
    });
    if (continueFrom) params.set("apcontinue", continueFrom);

    const url = `${apiUrl}?${params}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new Error(`MediaWiki API error: HTTP ${res.status}`);
    const data = JSON.parse(await res.text());

    for (const page of data.query?.allpages ?? []) {
      const title = page.title.replace(/ /g, "_");
      urls.push(`${baseUrl}${encodeURIComponent(title)}`);
    }

    if (data.continue?.apcontinue) {
      continueFrom = data.continue.apcontinue;
    } else {
      break;
    }
  }

  return urls;
}
