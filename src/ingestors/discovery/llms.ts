/**
 * llms.txt-family discovery.
 *
 *   - discoverFromLlmsIndex: top-level llms.txt enumerating per-service
 *     llms.txt URLs. Each child is fetched and treated as a flat page
 *     list. AWS-style structure.
 *   - discoverFromLlmsTxt: single llms.txt enumerating pages directly.
 *     Supports absolute URLs and relative paths inside markdown links
 *     `[title](path.md)` resolved against the llms.txt URL's origin.
 */
import { CONCURRENCY, fetchWithRetry } from "../http-client.js";

const URL_REGEX = /https?:\/\/[^\s)>]+/g;

export async function discoverFromLlmsIndex(
  indexUrl: string,
  urlPattern?: string,
): Promise<string[]> {
  const res = await fetchWithRetry(indexUrl);
  if (!res.ok) throw new Error(`Failed to fetch llms index ${indexUrl}: HTTP ${res.status}`);
  const text = await res.text();

  const allLinks = text.match(URL_REGEX) ?? [];
  let childLlmsUrls = allLinks.filter((u) => u.endsWith("/llms.txt") && u !== indexUrl);

  // Pre-filter by urlPattern alternation group, when present.
  if (urlPattern) {
    const altMatch = urlPattern.match(/\(([^)]+)\)/);
    if (altMatch) {
      const keywords = altMatch[1].split("|");
      childLlmsUrls = childLlmsUrls.filter((u) =>
        keywords.some((kw) => u.toLowerCase().includes(kw.toLowerCase())),
      );
    }
  }

  console.log(`  llms-index: ${childLlmsUrls.length} child llms.txt files to fetch`);

  const allUrls: string[] = [];
  for (let i = 0; i < childLlmsUrls.length; i += CONCURRENCY) {
    const batch = childLlmsUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const r = await fetchWithRetry(url);
        if (!r.ok) return [];
        const childText = await r.text();
        const childLinks = childText.match(URL_REGEX) ?? [];
        // Page URLs are anything ending in .md or .html and not a
        // sibling llms.txt. AWS migrated from .html to .md in 2026 —
        // we accept both so older mirrors still work.
        return childLinks.filter(
          (l) =>
            (l.endsWith(".md") || l.endsWith(".html")) &&
            !l.endsWith("/llms.txt") &&
            !l.endsWith("/llms-full.txt"),
        );
      }),
    );
    for (const result of results) {
      if (result.status === "fulfilled") allUrls.push(...result.value);
    }
  }

  return allUrls;
}

export async function discoverFromLlmsTxt(llmsTxtUrl: string): Promise<string[]> {
  const res = await fetchWithRetry(llmsTxtUrl);
  if (!res.ok) throw new Error(`Failed to fetch llms.txt ${llmsTxtUrl}: HTTP ${res.status}`);
  const text = await res.text();

  const urls = new Set<string>();

  // Extract absolute URLs
  const absRegex = /https?:\/\/[^\s)>\]]+/g;
  let match;
  while ((match = absRegex.exec(text)) !== null) {
    urls.add(match[0]);
  }

  // Extract relative paths from markdown links: [text](path)
  const mdLinkRegex = /\]\(([^)]+)\)/g;
  const base = new URL(llmsTxtUrl);
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const href = match[1];
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      urls.add(new URL(href, base).href);
    } catch { /* skip malformed */ }
  }

  // Drop self-references and other llms*.txt sibling files
  return [...urls].filter((u) => !u.endsWith("/llms.txt") && !u.endsWith("/llms-full.txt") && u !== llmsTxtUrl);
}
