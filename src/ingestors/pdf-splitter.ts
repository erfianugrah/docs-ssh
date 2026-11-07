/**
 * Splits a PDF's pdftotext -layout output into per-section markdown pages.
 *
 * Uses heading patterns to detect section boundaries, falling back to
 * fixed-size page chunks when no headings are found. The output preserves
 * column-aligned register tables (fenced code blocks) and adds per-page
 * origin notes (`[url]`) for searchability.
 *
 * Invokes pdftotext (poppler-utils) via node:child_process. The caller
 * (HttpIngestor) passes the file path and is responsible for checking
 * pdftotext exists before calling.
 */

/**
 * Sections grouped into one markdown file.
 * `heading` = the detected heading line (or page-range label).
 * `pages` = which PDF pages this section covers (1-indexed).
 * `lines` = the text body.
 */
export interface PdfSection {
  heading: string;
  firstPage: number;
  lastPage: number;
  lines: string[];
}

import { execFileSync } from "node:child_process";

/**
 * Run pdftotext -layout and return the full text + page count.
 * Caller must verify pdftotext is on PATH.
 */
export function pdftotextLayout(pdfPath: string): { text: string; pageCount: number } {
  const stdout = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf-8",
    maxBuffer: 256 << 20,
  });
  const trimmed = stdout.replace(/\f+$/, "");
  const pageCount = (trimmed.match(/\f/g) || []).length + 1;
  return { text: trimmed, pageCount };
}

/**
 * Regex for detecting a section heading line.
 *
 * Matches:
 *   "5.3 USB full-speed device interface (USBFS)"  - numbered
 *   "1.2.3 Some Topic"                            - dotted
 *   "Chapter 10 General-purpose I/O"              - chapter-style
 *   "REGISTER DESCRIPTION"                         - all-caps heading
 *   "FEATURES"                                     - all-caps short heading
 *
 * Does NOT match lines that are clearly table headers or incidental.
 */
const CAPS_MIN_LENGTH = 12;

function isHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Numbered heading: "5.3 USB full-speed device interface"
  // Must have at least 12 chars total (avoids single-digit bitfield lines
  // like "0 RST" or "1.2.3 Some bit") and not contain register R/W keywords.
  if (/^\d{1,3}(?:\.\d+)*\s+\S/.test(trimmed)) {
    if (trimmed.length < 12) return null;
    // Exclude register bitfield lines: these contain standalone RW/RO/W/R tokens
    // that real section headings never have.
    if (/\b(?:R[WO]?|W)\b/i.test(trimmed)) return null;
    return trimmed;
  }
  // Chapter/Appendix style
  if (/^(?:Chapter\s+\d+|Appendix\s+[A-Z])\b/i.test(trimmed)) {
    return trimmed;
  }
  // All-caps heading: at least CAPS_MIN_LENGTH chars
  if (
    trimmed.length >= CAPS_MIN_LENGTH &&
    /^[A-Z][A-Z\s\/\-]{11,}$/.test(trimmed) &&
    !/^TABLE\s/i.test(trimmed) &&
    !/^FIGURE\s/i.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

const FALLBACK_PAGES_PER_SECTION = 10;

interface InternalSection {
  heading: string | null; // null = fallback (compute heading at flush)
  firstPage: number;
  lines: string[];
  isFallback: boolean;
}

/**
 * Split pdftotext output into sections.
 */
export function splitPdfText(
  text: string,
  title: string,
  _pdfUrl: string,
): PdfSection[] {
  const rawPages = text.split("\f").filter((p) => p.trim().length > 0);
  if (rawPages.length === 0) return [];

  // Parse each page
  const pages: { lines: string[]; heading: string | null }[] = rawPages.map((pageText) => {
    const lines = pageText.split("\n");
    let heading: string | null = null;
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const h = isHeading(lines[i]);
      if (h) {
        heading = h;
        break;
      }
    }
    return { lines, heading };
  });

  // Group into sections
  const sections: PdfSection[] = [];
  let current: InternalSection | null = null;
  let headinglessInSection = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNum = i + 1;

    if (page.heading) {
      // Flush previous section
      if (current) {
        const h = current.isFallback
          ? `${title} (pages ${current.firstPage}-${pageNum - 1})`
          : current.heading!;
        sections.push({
          heading: h,
          firstPage: current.firstPage,
          lastPage: pageNum - 1,
          lines: current.lines,
        });
      }
      headinglessInSection = 0;
      current = {
        heading: page.heading,
        firstPage: pageNum,
        lines: [...page.lines],
        isFallback: false,
      };
    } else if (current) {
      if (current.isFallback) {
        // Continue fallback section
        headinglessInSection++;
        if (headinglessInSection > FALLBACK_PAGES_PER_SECTION) {
          // Section full - close and start new fallback
          const h = `${title} (pages ${current.firstPage}-${pageNum - 1})`;
          sections.push({
            heading: h,
            firstPage: current.firstPage,
            lastPage: pageNum - 1,
            lines: current.lines,
          });
          headinglessInSection = 1;
          current = {
            heading: null,
            firstPage: pageNum,
            lines: [...page.lines],
            isFallback: true,
          };
        } else {
          current.lines.push("", ...page.lines);
        }
      } else {
        // Continue a heading-started section
        current.lines.push("", ...page.lines);
      }
    } else {
      // No section active - start a fallback
      headinglessInSection = 1;
      current = {
        heading: null,
        firstPage: pageNum,
        lines: [...page.lines],
        isFallback: true,
      };
    }
  }

  // Flush last section
  if (current) {
    const h = current.isFallback
      ? `${title} (pages ${current.firstPage}-${pages.length})`
      : current.heading!;
    sections.push({
      heading: h,
      firstPage: current.firstPage,
      lastPage: pages.length,
      lines: current.lines,
    });
  }

  return sections;
}

/**
 * Convert a PdfSection to markdown content.
 */
export function sectionToMarkdown(
  section: PdfSection,
  title: string,
  pdfUrl: string,
): string {
  const body = section.lines.join("\n").trim();
  const h1 = section.heading.startsWith(title)
    ? section.heading
    : `${title} - ${section.heading}`;
  const pageNote =
    section.firstPage === section.lastPage
      ? `page ${section.firstPage}`
      : `pages ${section.firstPage}-${section.lastPage}`;

  return [
    `# ${h1}`,
    "",
    `> Source: ${pdfUrl} (${pageNote})`,
    "",
    "```text",
    body,
    "```",
    "",
  ].join("\n");
}

/**
 * Slugify a heading for a filename.
 * "5.3 USB full-speed device interface (USBFS)" -> "5-3-usb-full-speed-device-interface-usbfs"
 */
export function headingToSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]+/g, "")
    .replace(/[\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}