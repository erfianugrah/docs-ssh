/**
 * Splits an llms-full.txt file into per-page [path, content] entries.
 *
 * Supports three formats:
 *
 * Vercel/Next.js style — long dash separators with metadata blocks:
 *   ----------------
 *   title: "Page Title"
 *   source: "https://vercel.com/docs/functions"
 *   ----------------
 *   # Page Title
 *   content...
 *
 * Cloudflare style — YAML frontmatter per page:
 *   ---
 *   title: Argo Smart Routing
 *   description: ...
 *   ---
 *   [Skip to content]
 *   # Argo Smart Routing
 *   content...
 *
 * Heading style — continuous document split on top-level headings (Astro):
 *   # Why Astro?
 *   content...
 *   # Getting Started
 *   content...
 */
export function splitLlmsFull(
  content: string,
  baseUrl: string,
  origins?: Map<string, string>,
): Map<string, string> {
  // Vercel format: long-dash separator immediately followed by metadata lines
  // (title:, source:) within the next few lines — no content in between.
  const hasVercelMeta = /^-{10,}\s*\n(?:(?!\n\n)[^\n]*\n){0,10}source:\s/m.test(content);
  if (hasVercelMeta) {
    return splitVercelStyle(content, baseUrl, origins);
  }

  // Mintlify format: every page opens with `# Title` then `Source: <url>`.
  // Checked before the heading fallback, which would also split on
  // `# comment` lines inside code fences and lose the page URLs.
  const sourceLinePairs = content.match(SOURCE_LINE_PAIR_G)?.length ?? 0;
  if (sourceLinePairs >= 20) {
    return splitSourceLineStyle(content, baseUrl, origins);
  }

  // Try frontmatter style first. Each candidate fills its own origin map;
  // only the returned split's origins are reported.
  const fmOrigins = new Map<string, string>();
  const fmResult = splitFrontmatterStyle(content, baseUrl, fmOrigins);
  if (fmResult.size > 20) {
    copyInto(origins, fmOrigins);
    return fmResult;
  }

  // Fallback: split on top-level headings (# Title) for continuous docs
  const headingOrigins = new Map<string, string>();
  const headingResult = splitHeadingStyle(content, baseUrl, headingOrigins);
  if (headingResult.size > fmResult.size) {
    copyInto(origins, headingOrigins);
    return headingResult;
  }

  copyInto(origins, fmOrigins);
  return fmResult;
}

function copyInto(to: Map<string, string> | undefined, from: Map<string, string>): void {
  if (to) for (const [k, v] of from) to.set(k, v);
}

/**
 * Public page URL from a marker in the dump: absolute, or relative to
 * baseUrl. A markdown twin (`/x/index.md`, `/x.md`) maps to the HTML page
 * (`/x/`, `/x`). Undefined when the marker is not a URL.
 */
export function pageUrlFromMarker(raw: string, baseUrl: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^["']|["']$/g, ""), baseUrl || undefined);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(u.protocol)) return undefined;
  if (u.pathname.endsWith("/index.md")) u.pathname = u.pathname.slice(0, -"index.md".length);
  else if (u.pathname.endsWith(".md")) u.pathname = u.pathname.slice(0, -".md".length);
  return u.href;
}

/** `url:` in a frontmatter block (nextjs), else the page's own "View as Markdown" link (cloudflare). */
const FM_URL = /^url:\s*(\S+)\s*$/m;
const VIEW_AS_MARKDOWN = /\[View as Markdown\]\((https?:\/\/[^)\s]+)\)/;
/** A url-only frontmatter block (vitest, vite, bitwarden) that opens the next page. */
const URL_ONLY_FM = /^(?:URL|url):\s*(\S+)\s*$/;
/** `URL: <url>` in the first lines after a page heading (deno). */
const URL_LINE = /^URL: (https?:\/\/\S+)\s*$/;

const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * File name for a page whose title slug is already taken (docs-ssh#12).
 * Prefer a name from the page URL: the slug plus the URL's path segments,
 * minus a final segment that repeats the slug (/hyperdrive/platform/limits/
 * for "Limits" -> limits-hyperdrive-platform.md). That name survives the
 * vendor inserting pages earlier in the dump, which renamed every later
 * position-suffixed page (cloudflare limits-3600.md -> limits-3603.md).
 * Falls back to `<slug>-<fallback>.md` without a URL or when the URL name
 * is taken too.
 * simplify: the FIRST page with a title keeps the bare slug, so a new
 * same-titled page inserted before it still swaps the two; suffixing every
 * member of a duplicate group would fix that at the cost of renaming them.
 */
function duplicateName(
  slug: string,
  url: string | undefined,
  taken: Map<string, string>,
  fallback: number | string,
): string {
  if (url) {
    try {
      const segs = new URL(url).pathname.split("/").map(slugify).filter(Boolean);
      if (segs.length && segs[segs.length - 1] === slug) segs.pop();
      const name = [slug, ...segs].filter(Boolean).join("-");
      if (segs.length && !taken.has(`${name}.md`)) return `${name}.md`;
    } catch {
      // not a URL: fall through
    }
  }
  return slug ? `${slug}-${fallback}.md` : `page-${fallback}-dup.md`;
}

/**
 * Vercel format: pages separated by long-dash lines (80 dashes),
 * with title/source metadata between separators, then content after.
 */
/** `# Title` immediately followed by `Source: <url>` (Mintlify llms-full). */
const SOURCE_LINE_PAIR = /^# (.+)\nSource: (https?:\/\/\S+)[ \t]*$/m;
const SOURCE_LINE_PAIR_G = new RegExp(SOURCE_LINE_PAIR.source, "gm");

/** Page path from its public URL: relative to baseUrl, else the URL path. */
function urlToPagePath(url: string, baseUrl: string): string {
  let filePath: string;
  if (url.startsWith(baseUrl)) {
    filePath = url.slice(baseUrl.length);
  } else {
    try {
      filePath = new URL(url).pathname;
    } catch {
      filePath = url;
    }
  }
  filePath = filePath.replace(/[?#].*$/, "").replace(/^\/+/, "").replace(/\/$/, "");
  if (!filePath) filePath = "index";
  if (!filePath.endsWith(".md")) filePath += ".md";
  return filePath;
}

/**
 * Mintlify format (docs.fly.io, bunny.net, paradedb): pages concatenated,
 * each opening with `# Title` and a `Source: <url>` line. Splits only on
 * that pair, so `#` comment lines inside code fences stay in their page.
 * The Source line is dropped from the body and recorded in `origins`.
 */
export function splitSourceLineStyle(
  content: string,
  baseUrl: string,
  origins?: Map<string, string>,
): Map<string, string> {
  const pages = new Map<string, string>();
  const starts: { index: number; title: string; url: string; headerEnd: number }[] = [];
  for (const m of content.matchAll(SOURCE_LINE_PAIR_G)) {
    starts.push({ index: m.index!, title: m[1].trim(), url: m[2], headerEnd: m.index! + m[0].length });
  }
  for (let i = 0; i < starts.length; i++) {
    const { title, url, headerEnd } = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : content.length;
    const body = content.slice(headerEnd, end).trim();
    const filePath = urlToPagePath(url, baseUrl);
    pages.set(filePath, body ? `# ${title}\n\n${body}` : `# ${title}`);
    origins?.set(filePath, url);
  }
  return pages;
}

export function splitVercelStyle(
  content: string,
  baseUrl: string,
  origins?: Map<string, string>,
): Map<string, string> {
  const pages = new Map<string, string>();
  const separator = /^-{10,}\s*$/m;
  const blocks = content.split(separator);

  let currentTitle = "";
  let currentSource = "";

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const titleMatch = trimmed.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
    const sourceMatch = trimmed.match(/^source:\s*"?([^"\n]+)"?\s*$/m);

    if (titleMatch && sourceMatch) {
      currentTitle = titleMatch[1];
      currentSource = sourceMatch[1];
      continue;
    }

    if (currentSource) {
      let filePath = currentSource;
      if (filePath.startsWith(baseUrl)) filePath = filePath.slice(baseUrl.length);
      filePath = filePath.replace(/^\/+/, "").replace(/\/$/, "");
      if (!filePath) filePath = "index";
      if (!filePath.endsWith(".md")) filePath += ".md";

      // Inject title as H1 if content doesn't already start with one.
      // Current Vercel format includes '# Title' inline, so this is
      // usually a no-op — but if upstream ever drops the inline
      // heading, titles are preserved instead of vanishing.
      const contentToStore =
        currentTitle && !trimmed.trimStart().startsWith("# ")
          ? `# ${currentTitle}\n\n${trimmed}`
          : trimmed;

      pages.set(filePath, contentToStore);
      if (/^https?:\/\//.test(currentSource)) origins?.set(filePath, currentSource);
      currentTitle = "";
      currentSource = "";
    }
  }

  return pages;
}

/**
 * Cloudflare format: each page starts with a YAML frontmatter block
 * (---\ntitle: ...\n---), followed by the page content.
 *
 * Key challenge: pages can contain bare --- lines (markdown <hr> rules).
 * We distinguish frontmatter from HRs by requiring that a frontmatter
 * block contains at least one "key: value" line (specifically "title:").
 */
export function splitFrontmatterStyle(
  content: string,
  baseUrl: string,
  origins?: Map<string, string>,
): Map<string, string> {
  const pages = new Map<string, string>();

  // Find all frontmatter blocks: ---\n<yaml with title:>\n---
  // The key insight: YAML frontmatter must contain a "title:" line.
  // A bare ---\n\n--- or ---\n## Heading\n--- is NOT frontmatter.
  const fmPositions: { start: number; end: number; title: string; url?: string }[] = [];

  // Scan line-by-line to find frontmatter blocks reliably
  const lines = content.split("\n");
  let i = 0;
  let charPos = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^---\s*$/.test(line)) {
      // Potential frontmatter opening. Scan ahead for key: value lines and closing ---
      const fmStart = charPos;
      let j = i + 1;
      let yamlContent = "";
      let foundClose = false;

      while (j < lines.length) {
        if (/^---\s*$/.test(lines[j])) {
          foundClose = true;
          break;
        }
        yamlContent += lines[j] + "\n";
        j++;
      }

      if (foundClose && yamlContent.trim()) {
        const titleMatch = yamlContent.match(/^title:\s*(.+)$/m);
        if (titleMatch) {
          const title = titleMatch[1].replace(/^["']|["']$/g, "").trim();
          // charPos for line j+1 (after closing ---)
          let endCharPos = fmStart;
          for (let k = i; k <= j; k++) {
            endCharPos += lines[k].length + 1; // +1 for \n
          }
          const url = yamlContent.match(FM_URL)?.[1];
          fmPositions.push({ start: fmStart, end: endCharPos, title, url });
          i = j + 1;
          charPos = endCharPos;
          continue;
        }
      }
    }

    charPos += line.length + 1; // +1 for \n
    i++;
  }

  // Extract page content between frontmatter blocks
  for (let idx = 0; idx < fmPositions.length; idx++) {
    const contentStart = fmPositions[idx].end;
    const contentEnd = idx + 1 < fmPositions.length
      ? fmPositions[idx + 1].start
      : content.length;

    const pageContent = content.slice(contentStart, contentEnd).trim();
    const title = fmPositions[idx].title;

    if (!pageContent || !title) continue;

    const slug = slugify(title);
    const marker = fmPositions[idx].url ?? pageContent.slice(0, 2000).match(VIEW_AS_MARKDOWN)?.[1];
    const url = marker ? pageUrlFromMarker(marker, baseUrl) : undefined;
    let filePath = slug ? `${slug}.md` : `page-${idx}.md`;
    // Duplicate title: name from the URL, else the page's idx (stable
    // against skipped blocks, unlike pages.size). See duplicateName.
    if (pages.has(filePath)) filePath = duplicateName(slug, url, pages, idx);
    pages.set(filePath, pageContent);
    if (url) origins?.set(filePath, url);
  }

  return pages;
}

/**
 * Heading style: continuous document split on top-level `# Heading` lines.
 * Used for llms-full.txt files that are a single concatenated document
 * with no frontmatter or separators (e.g. Astro).
 */
export function splitHeadingStyle(
  content: string,
  baseUrl = "",
  origins?: Map<string, string>,
): Map<string, string> {
  const pages = new Map<string, string>();
  const lines = content.split("\n");

  let currentTitle = "";
  let currentLines: string[] = [];
  let currentUrl: string | undefined;

  function flush() {
    if (!currentTitle || currentLines.length === 0) return;
    const pageContent = currentLines.join("\n").trim();
    if (!pageContent) return;

    const slug = slugify(currentTitle);
    const marker = currentUrl ?? currentLines.slice(0, 8).map((l) => l.match(URL_LINE)?.[1]).find(Boolean);
    const url = marker ? pageUrlFromMarker(marker, baseUrl) : undefined;
    let filePath = slug ? `${slug}.md` : `page-${pages.size}.md`;

    // Duplicate title: name from the URL, else a size suffix (as before).
    if (pages.has(filePath)) filePath = duplicateName(slug, url, pages, pages.size);
    pages.set(filePath, `# ${currentTitle}\n\n${pageContent}`);
    if (url) origins?.set(filePath, url);
  }

  /** Pops a trailing `---` / `url: X` / `---` block (it opens the next page) and returns X. */
  function takeTrailingUrlBlock(): string | undefined {
    let end = currentLines.length;
    while (end > 0 && !currentLines[end - 1].trim()) end--;
    if (end < 3) return undefined;
    const [open, mid, close] = currentLines.slice(end - 3, end);
    const url = mid.match(URL_ONLY_FM)?.[1];
    if (!/^---\s*$/.test(open) || !/^---\s*$/.test(close) || !url) return undefined;
    currentLines = currentLines.slice(0, end - 3);
    return url;
  }

  for (const line of lines) {
    const headingMatch = line.match(/^# (.+)$/);
    if (headingMatch) {
      const nextUrl = takeTrailingUrlBlock();
      flush();
      currentTitle = headingMatch[1].trim();
      currentLines = [];
      currentUrl = nextUrl;
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return pages;
}
