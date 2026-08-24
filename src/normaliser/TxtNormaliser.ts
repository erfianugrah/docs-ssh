import { DocFile } from "../domain/DocFile.js";
import type { DocFormat } from "../domain/DocSource.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";

/** Series prefixes used by the RFC Editor's text module (rfc/, bcp/, fyi/, ien/, std/). */
const SERIES_FILE_RE = /^(rfc|bcp|fyi|ien|std)[_-]?(\d+)$/i;

/** Explicit "Title:" field used by very old RFCs (e.g. RFC 1). */
const EXPLICIT_TITLE_RE = /^\s*Title:\s+(.+?)\s*$/;

/**
 * Header-block field labels that terminate a title run (RFC 1 style).
 * The colon is required: without it, real titles like RFC 9557's
 * "Date and Time on the Internet: ..." match on the word "Date".
 */
const FIELD_LABEL_RE = /^\s*(?:Author|Installation|Date|Network Working Group Request)\s*:/;

/** Recognised first line of an RFC header block (any era). */
// Leading whitespace allowed: some 1980s RFCs (e.g. RFC 978) indent the
// whole header block.
const HEADER_START_RE =
  /^\s*(?:Internet Engineering Task Force|Internet Architecture Board|Network Working Group|Request for Comments|RFC:|STD:|BCP:|FYI:|IEN:)/;

/** Section heads that terminate a flush-left title run (recent xml2rfc). */
const SECTION_HEAD_RE =
  /^(?:Abstract|Status of [tT]his Memo|Table of Contents|CONTENTS|Introduction)\s*$|^\d+\.\s/;

/** Date lines in the header block: "September 1981", "7 April 1969", "June 2022". */
const DATE_LINE_RE =
  /^(?:(?:\d{1,2})\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(?:\d{1,2},\s+)?\d{4}$/i;

/** Page footer lines emitted by the RFC text formatter. */
const PAGE_FOOTER_RE = /^\s*\[Page \d+\]\s*$/;

/** How many leading lines to scan for the title (RFC headers fit comfortably). */
const TITLE_SCAN_LINES = 60;

const MAX_TITLE_LEN = 150;

/**
 * Format converter for plain-text documents (format: "txt"), built for the
 * IETF RFC corpus. Wraps the ASCII body in a fenced code block (preserving
 * fixed-width pagination, tables, and ASCII art) and prepends an H1 heading
 * so build-index.ts gets a real title row for search.
 *
 * Heading is "<SERIES> <N>: <title>" parsed from the filename plus the RFC
 * header block:
 *   (a) an explicit "Title:" field (very old RFCs), else
 *   (b) the first run of indented lines after the left-column header
 *       block (Request for Comments:, Obsoletes:, ...), stopping at
 *       blanks, field labels, date lines, rule lines, or section starts.
 *
 * Cleanup: strips the UTF-8 BOM, form-feed page breaks, and "[Page N]"
 * footers. Title indent of 1+ is accepted because recent xml2rfc versions
 * wrap long titles at column 1-3 (verified on RFC 9968/9970/9985/9999).
 * simplify: repeated per-page header lines (e.g. "RFC 9293  TCP  August 2022")
 * are kept verbatim - heuristic removal risks eating real content; revisit if
 * search snippets prove too noisy.
 */
export class TxtNormaliser implements DocNormaliser {
  readonly name = "TxtNormaliser";

  supports(file: DocFile): boolean {
    // .txt (ietf-rfc) plus the extensions GitIngestor walks for txt
    // git sources: .h (NVAPI SDK headers) and .py/.cpp (PenguinBurner
    // hidden-NVAPI reference code). Heading extraction falls back to
    // the bare filename when no RFC header block matches.
    return ["txt", "h", "py", "cpp"].includes(file.extension);
  }

  supportsFormat(format: DocFormat): boolean {
    return format === "txt";
  }

  async normalise(file: DocFile): Promise<DocFile | null> {
    const heading = extractHeading(file.path, file.content);
    const body = cleanBody(file.content);
    // Guard against the fence sequence appearing in the source text.
    const fence = body.includes("\n```") ? "~~~~" : "```";
    // The abstract goes OUTSIDE the fence as plain prose: build-index.ts
    // takes its summary from the first prose line, so this is what makes
    // docs_search summaries useful for RFCs.
    const abstract = extractAbstract(body);
    const parts = [`# ${heading}`];
    if (abstract) parts.push(abstract);
    // Strip any source extension (.txt for RFCs, .h/.py/.cpp for git
    // code sources) - the served file is always .md.
    const mdPath = file.path.replace(/\.[a-z0-9]+$/i, ".md");
    parts.push(`${fence}text\n${body}\n${fence}`);
    return new DocFile(mdPath, parts.join("\n\n") + "\n");
  }
}

function extractHeading(filePath: string, content: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const m = stem.match(SERIES_FILE_RE);
  const label = m ? `${m[1].toUpperCase()} ${parseInt(m[2], 10)}` : stem;

  const lines = content.replace(/^\uFEFF/, "").split("\n", TITLE_SCAN_LINES);

  // (a) explicit Title: field
  for (const line of lines) {
    const t = line.match(EXPLICIT_TITLE_RE);
    if (t) return `${label}: ${truncate(t[1])}`;
  }

  // (b) locate the header block by its recognised first-line prefix
  //     (preamble notes like bcp9's "[Note that this file ...]" sit
  //     before it), consume to the first blank line, then take the
  //     title run. Once a real header block was seen, ANY indent is
  //     accepted - recent xml2rfc versions emit long titles flush-left
  //     (verified on RFC 9766/9973) - so the run terminates on section
  //     heads instead. Without a recognised header the run stays strict
  //     (indented lines only) so non-RFC files (indexes etc.) fall back
  //     to the bare filename label rather than grabbing junk.
  let i = lines.findIndex((l) => HEADER_START_RE.test(l));
  const strict = i < 0;
  if (!strict) {
    while (i < lines.length && lines[i].trim() !== "") i++;
    while (i < lines.length && lines[i].trim() === "") i++;
  } else {
    i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
  }

  const titleLines: string[] = [];
  while (i < lines.length && titleLines.length < 5) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") break;
    if (strict && !/^\s+\S/.test(line)) break;
    if (SECTION_HEAD_RE.test(trimmed)) break;
    if (FIELD_LABEL_RE.test(line)) break;
    if (DATE_LINE_RE.test(trimmed)) break;
    if (/^[-=~_]+$/.test(trimmed)) break;
    titleLines.push(trimmed);
    i++;
  }

  const title = titleLines.join(" ").replace(/\s+/g, " ").trim();
  if (title.length < 3) return label;
  return `${label}: ${truncate(title)}`;
}

/** Max length of the extracted abstract paragraph. */
const MAX_ABSTRACT_LEN = 400;

/**
 * Extract the first paragraph of the Abstract section, unwrapped.
 * Matches only a column-0 "Abstract" section head (TOC entries are
 * indented, so they don't false-positive). Returns "" when absent.
 */
function extractAbstract(body: string): string {
  const lines = body.split("\n", 400);
  let i = lines.findIndex((l) => /^Abstract\s*$/.test(l));
  if (i < 0) return "";
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const para: string[] = [];
  while (i < lines.length && lines[i].trim() !== "") {
    para.push(lines[i].trim());
    i++;
  }
  const text = para.join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 3) return "";
  return text.length > MAX_ABSTRACT_LEN ? `${text.slice(0, MAX_ABSTRACT_LEN)}...` : text;
}

function cleanBody(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\f/g, "")
    .split("\n")
    .filter((line) => !PAGE_FOOTER_RE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(title: string): string {
  return title.length > MAX_TITLE_LEN ? `${title.slice(0, MAX_TITLE_LEN)}...` : title;
}
