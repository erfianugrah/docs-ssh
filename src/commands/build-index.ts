/**
 * Builds the docs search index — one TSV row per markdown file:
 *
 *     <relative-path>\t<title>\t<summary>\n
 *
 * This is a parser, not a filter. EVERY `*.md` under the docs root
 * gets a row; files with poor or missing titles still appear (with
 * an empty title field) so they remain discoverable via filename
 * search at runtime.
 *
 * Replaces the previous `build-index.sh` awk implementation:
 *
 *   - Real YAML parsing for frontmatter (handles block scalars
 *     `description: >-` correctly, multi-line `|` literal blocks,
 *     embedded `---` inside string values, quoted strings with
 *     escape sequences). The awk version handled a narrow subset
 *     and silently mishandled the rest.
 *   - Code-fence tracking with both ``` and ~~~ delimiters.
 *   - Same sanitisation as ContentSanitiser (ANSI + control bytes).
 *   - Tabs in titles/summary become spaces so the TSV stays parseable.
 *
 * Usage:
 *   node --import tsx/esm src/commands/build-index.ts /docs > /docs/_index.tsv
 *   node --import tsx/esm src/commands/build-index.ts /docs /docs/_index.tsv
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";

export interface IndexRow {
  path: string;
  title: string;
  summary: string;
}

export interface ParseOptions {
  /** Cap on title length in characters. Default: 200. */
  readonly titleMax?: number;
  /** Cap on summary length in characters. Default: 300. */
  readonly summaryMax?: number;
  /** Number of leading headings collected into the summary. Default: 5. */
  readonly headingCount?: number;
}

const DEFAULTS = { titleMax: 200, summaryMax: 300, headingCount: 5 } as const;

// ─── ANSI/control-byte sanitiser ────────────────────────────────────
// Mirrors ContentSanitiser. Re-implemented locally to keep this script
// independent (it has to work at Docker build time before any other
// module is bundled).
//
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[^[\]].?/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x01-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g;

function sanitise(s: string): string {
  return s.replace(ANSI_RE, "").replace(/\t/g, " ").replace(/\r/g, "").replace(CONTROL_RE, "");
}

// ─── Frontmatter split ─────────────────────────────────────────────
// Strict: only opening `---` on line 1 (with optional trailing
// whitespace). The matching close is the next `---` on its own line.
// Returns [yamlBody, contentStart] — contentStart is the line index
// AFTER the closing `---`. If no frontmatter, returns [null, 0].

function splitFrontmatter(lines: readonly string[]): [string | null, number] {
  if (lines.length === 0 || !/^---[ \t]*$/.test(lines[0])) return [null, 0];
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      return [lines.slice(1, i).join("\n"), i + 1];
    }
  }
  // Unclosed frontmatter — treat the whole file as content.
  return [null, 0];
}

interface Frontmatter {
  title: string;
  description: string;
}

function parseFrontmatter(yamlBody: string | null): Frontmatter {
  if (!yamlBody) return { title: "", description: "" };
  // Pre-sanitise the YAML body: ANSI escape sequences and control
  // bytes have no semantic meaning in frontmatter and js-yaml refuses
  // to parse strings containing them. The awk version regex-extracted
  // values without parsing YAML, so it tolerated this; we sanitise
  // here to match that lenience without weakening downstream parsing.
  let parsed: unknown;
  try {
    parsed = yaml.load(sanitise(yamlBody));
  } catch {
    return { title: "", description: "" };
  }
  if (!parsed || typeof parsed !== "object") return { title: "", description: "" };
  const obj = parsed as Record<string, unknown>;
  const pick = (k: string): string => {
    const v = obj[k];
    return typeof v === "string" ? v : "";
  };
  // `oneline` is a Cloudflare/Vercel convention used as a fallback
  // when `description` isn't present.
  return {
    title: pick("title"),
    description: pick("description") || pick("oneline"),
  };
}

// ─── Content scan ──────────────────────────────────────────────────

interface ContentSignals {
  /** First ATX heading text (without `#` markers). */
  firstHeading: string;
  /** Up to N headings joined by space (used in summary fallback). */
  headings: string;
  /** First prose line (heuristic). */
  content: string;
}

const HEADING_RE = /^#+\s+/;
const FENCE_RE = /^(?:```|~~~)/;
/**
 * Rough first-prose-line heuristic. Matches lines that don't start
 * with markdown syntax characters; requires at least three alphabetic
 * characters in the line so URL-only lines, image alt-text leftovers,
 * and similar noise are skipped.
 */
const PROSE_START_RE = /^[^#`\-|<>![]/;
const PROSE_ALPHA_RE = /[A-Za-z].*[A-Za-z].*[A-Za-z]/;

function scanContent(lines: readonly string[], opts: Required<ParseOptions>): ContentSignals {
  let firstHeading = "";
  const allHeadings: string[] = [];
  let content = "";
  let inFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (HEADING_RE.test(line)) {
      const h = line.replace(HEADING_RE, "");
      if (!firstHeading) firstHeading = h;
      if (allHeadings.length < opts.headingCount) allHeadings.push(h);
      continue;
    }

    if (!content && PROSE_START_RE.test(line) && PROSE_ALPHA_RE.test(line)) {
      content = line;
    }
  }

  return {
    firstHeading,
    headings: allHeadings.join(" "),
    content,
  };
}

// ─── Row composition ───────────────────────────────────────────────

export function buildRow(relpath: string, raw: string, opts: ParseOptions = {}): IndexRow {
  const o = { ...DEFAULTS, ...opts };
  const lines = raw.split("\n");
  const [yamlBody, contentStart] = splitFrontmatter(lines);
  const fm = parseFrontmatter(yamlBody);
  const signals = scanContent(lines.slice(contentStart), o);

  // Title precedence: frontmatter > first heading > first prose line.
  // The prose-line fallback keeps untitled files discoverable at all.
  let title = fm.title || signals.firstHeading || signals.content;
  title = sanitise(title).slice(0, o.titleMax);

  // Summary precedence: frontmatter description (optionally extended
  // with headings up to summaryMax) > "headings + content". The latter
  // is the awk default — keep it for parity.
  let summary: string;
  if (fm.description) {
    summary = fm.description;
    if (summary.length < o.titleMax && signals.headings) {
      const remaining = o.summaryMax - summary.length;
      summary = `${summary} ${signals.headings}`.slice(0, summary.length + remaining);
    }
  } else {
    summary = `${signals.headings.slice(0, o.summaryMax)} ${signals.content.slice(0, o.titleMax)}`;
  }
  summary = sanitise(summary).slice(0, o.summaryMax);

  return { path: relpath, title, summary };
}

// ─── Walk + emit ───────────────────────────────────────────────────

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  // Sort within each directory for deterministic output across
  // filesystems. The awk version piped through `sort -z` once at the
  // top — same effect with depth-first lexicographic walk here.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, root);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield path.relative(root, full);
    }
  }
}

export async function buildIndex(rootDir: string): Promise<IndexRow[]> {
  const rows: IndexRow[] = [];
  for await (const rel of walk(rootDir, rootDir)) {
    const raw = await fs.readFile(path.join(rootDir, rel), "utf-8");
    rows.push(buildRow(rel, raw));
  }
  return rows;
}

export function rowsToTsv(rows: readonly IndexRow[]): string {
  return rows.map((r) => `${r.path}\t${r.title}\t${r.summary}`).join("\n") + (rows.length ? "\n" : "");
}

// ─── Main ──────────────────────────────────────────────────────────
// Only runs when invoked as a script. Allows direct import from tests.

const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;

if (invokedAsScript) {
  const rootDir = process.argv[2] ?? "/docs";
  const outFile = process.argv[3];
  const rows = await buildIndex(rootDir);
  const tsv = rowsToTsv(rows);
  if (outFile) {
    await fs.writeFile(outFile, tsv, "utf-8");
  } else {
    process.stdout.write(tsv);
  }
}
