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
export function splitLlmsFull(content: string, baseUrl: string): Map<string, string> {
  // Vercel format: long-dash separator immediately followed by metadata lines
  // (title:, source:) within the next few lines — no content in between.
  const hasVercelMeta = /^-{10,}\s*\n(?:(?!\n\n)[^\n]*\n){0,10}source:\s/m.test(content);
  if (hasVercelMeta) {
    return splitVercelStyle(content, baseUrl);
  }

  // Try frontmatter style first
  const fmResult = splitFrontmatterStyle(content, baseUrl);
  if (fmResult.size > 20) {
    return fmResult;
  }

  // Fallback: split on top-level headings (# Title) for continuous docs
  const headingResult = splitHeadingStyle(content);
  if (headingResult.size > fmResult.size) {
    return headingResult;
  }

  return fmResult;
}

/**
 * Vercel format: pages separated by long-dash lines (80 dashes),
 * with title/source metadata between separators, then content after.
 */
export function splitVercelStyle(content: string, baseUrl: string): Map<string, string> {
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
export function splitFrontmatterStyle(content: string, _baseUrl: string): Map<string, string> {
  const pages = new Map<string, string>();

  // Find all frontmatter blocks: ---\n<yaml with title:>\n---
  // The key insight: YAML frontmatter must contain a "title:" line.
  // A bare ---\n\n--- or ---\n## Heading\n--- is NOT frontmatter.
  const fmPositions: { start: number; end: number; title: string }[] = [];

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
          fmPositions.push({ start: fmStart, end: endCharPos, title });
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

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let filePath = slug ? `${slug}.md` : `page-${idx}.md`;
    // Deduplicate: if slug already exists, append a suffix (same as splitHeadingStyle)
    if (pages.has(filePath)) {
      filePath = slug ? `${slug}-${pages.size}.md` : `page-${idx}-${pages.size}.md`;
    }
    pages.set(filePath, pageContent);
  }

  return pages;
}

/**
 * Heading style: continuous document split on top-level `# Heading` lines.
 * Used for llms-full.txt files that are a single concatenated document
 * with no frontmatter or separators (e.g. Astro).
 */
export function splitHeadingStyle(content: string): Map<string, string> {
  const pages = new Map<string, string>();
  const lines = content.split("\n");

  let currentTitle = "";
  let currentLines: string[] = [];

  function flush() {
    if (!currentTitle || currentLines.length === 0) return;
    const pageContent = currentLines.join("\n").trim();
    if (!pageContent) return;

    const slug = currentTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filePath = slug ? `${slug}.md` : `page-${pages.size}.md`;

    // Deduplicate: if slug already exists, append a suffix
    if (pages.has(filePath)) {
      pages.set(`${slug}-${pages.size}.md`, `# ${currentTitle}\n\n${pageContent}`);
    } else {
      pages.set(filePath, `# ${currentTitle}\n\n${pageContent}`);
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^# (.+)$/);
    if (headingMatch) {
      flush();
      currentTitle = headingMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return pages;
}
