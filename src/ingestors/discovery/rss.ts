/**
 * RSS feed discovery. Extracts page URLs from `<link>` elements inside
 * `<item>` blocks only; the top-level channel `<link>` (the feed's own
 * homepage) is ignored on purpose. Relative links (Hugo tag feeds such as
 * greatscottgadgets.com/tags/<tag>/index.xml emit root-relative ones) are
 * resolved against the feed URL; anything that is not http(s) afterwards is
 * dropped.
 */
import { BULK_RETRIES, fetchWithRetry } from "../http-client.js";

export function extractRssLinks(xml: string, feedUrl: string): string[] {
  const urls: string[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const linkRegex = /<link>\s*(?:<!\[CDATA\[)?\s*([^\s<\]]+?)\s*(?:\]\]>)?\s*<\/link>/;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const linkMatch = match[1].match(linkRegex);
    if (!linkMatch) continue;
    let resolved: URL;
    try {
      resolved = new URL(linkMatch[1], feedUrl);
    } catch {
      continue;
    }
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      urls.push(resolved.href);
    }
  }
  return urls;
}

export async function discoverFromRss(rssUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(rssUrl, BULK_RETRIES);
  if (!res.ok) throw new Error(`Failed to fetch RSS ${rssUrl}: HTTP ${res.status}`);
  return extractRssLinks(await res.text(), rssUrl);
}
