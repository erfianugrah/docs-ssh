/**
 * RSS feed discovery. Extracts page URLs from `<link>` elements inside
 * `<item>` blocks only; the top-level channel `<link>` (the feed's own
 * homepage) is ignored on purpose.
 */
import { fetchWithRetry } from "../http-client.js";

export async function discoverFromRss(rssUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(rssUrl);
  if (!res.ok) throw new Error(`Failed to fetch RSS ${rssUrl}: HTTP ${res.status}`);
  const xml = await res.text();

  const urls: string[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const linkRegex = /<link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+?)\s*(?:\]\]>)?\s*<\/link>/;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const linkMatch = match[1].match(linkRegex);
    if (linkMatch) {
      urls.push(linkMatch[1]);
    }
  }

  return urls;
}
