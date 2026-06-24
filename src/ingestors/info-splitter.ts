/**
 * Splits a GNU info (texinfo-generated) manual into per-node markdown.
 *
 * GNU info files concatenate every documentation "node" into one text
 * file, delimited by a `0x1f` (Unit Separator) byte on its own line,
 * followed by a header line:
 *
 *   <0x1f>
 *   File: manual.info.tmp,  Node: select,  Next: x,  Prev: y,  Up: z
 *
 *   15.2.13 SELECT Statement
 *   ------------------------
 *   ...body...
 *
 * This is the only mirror-able form of the MySQL Reference Manual —
 * `mysql-X.info.zip` from downloads.mysql.com. We split on the `0x1f`
 * separator, emit one `<node-id>.md` per node, and translate the small
 * set of texinfo rendering conventions into markdown:
 *
 *   - setext-style underlines (`===`, `---`, `...`, `***`) → ATX `#`
 *     headings, level chosen by the underline character
 *   - `* Menu:` blocks → markdown bullet lists of `[desc](node.md)`
 *   - inline `*note label: node.` / `*note node::` cross-references →
 *     `[label](node.md)`
 *
 * Non-content sections (the trailing `Tag Table`, which has no
 * `Node:` header) are skipped.
 */

/** Map a texinfo underline character to a markdown heading level. */
const UNDERLINE_LEVEL: Record<string, number> = {
  "*": 1,
  "=": 2,
  "-": 3,
  ".": 4,
  "~": 5,
  "+": 6,
};

interface ParsedNode {
  id: string;
  up: string | undefined;
  body: string;
}

/**
 * Split the raw info text into per-node markdown files.
 * Returns a map of `<node-id>.md` → markdown content.
 */
export function splitTexinfo(content: string): Map<string, string> {
  const pages = new Map<string, string>();
  // Normalise CRLF, then split on the info node separator (0x1f at the
  // start of a line). The first chunk is the file preamble (before the
  // first separator) and carries no Node: header — it is skipped by the
  // header check below.
  const chunks = content.replace(/\r\n/g, "\n").split(/\x1f\n?/);

  for (const chunk of chunks) {
    const node = parseNode(chunk);
    if (!node) continue;
    const slug = nodeSlug(node.id);
    if (!slug) continue;
    const md = renderNode(node);
    if (!md.trim()) continue;
    // Deterministic dedupe: info node ids are unique, but the slug
    // transform could collide (e.g. `Foo` vs `foo`). Suffix on collision.
    let filePath = `${slug}.md`;
    if (pages.has(filePath)) filePath = `${slug}-${pages.size}.md`;
    pages.set(filePath, md);
  }

  return pages;
}

/** Parse a single node chunk into its id, parent, and body. */
function parseNode(chunk: string): ParsedNode | null {
  const nl = chunk.indexOf("\n");
  if (nl === -1) return null;
  const header = chunk.slice(0, nl);
  // File: <file>,  Node: <id>,  Next: ...,  Prev: ...,  Up: <up>
  const nodeMatch = header.match(/^File:[^,]*,\s*Node:\s*([^,]+?)\s*(?:,|$)/);
  if (!nodeMatch) return null;
  const id = nodeMatch[1].trim();
  const upMatch = header.match(/Up:\s*([^,]+?)\s*(?:,|$)/);
  const up = upMatch ? upMatch[1].trim() : undefined;
  return { id, up, body: chunk.slice(nl + 1) };
}

/** Turn a node id into a filesystem-safe slug (without extension). */
function nodeSlug(id: string): string {
  if (id === "Top") return "index";
  const slug = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

/** Render one parsed node to markdown. */
function renderNode(node: ParsedNode): string {
  // Drop stray separator bytes, then resolve cross-references over the
  // whole body first — `*note` refs frequently wrap across a newline, so
  // a line-by-line pass would miss most of them.
  const body = convertInlineRefs(node.body.replace(/\x1f/g, ""));

  const lines = body.split("\n");

  // First pass: find the shallowest underline level present so the
  // node's top heading becomes H1 and deeper sections nest beneath it,
  // regardless of the absolute texinfo section depth (a leaf node titled
  // "15.2.13 ..." with a `-` underline should still render as `#`).
  let minLevel = Infinity;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() !== "" && isUnderline(lines[i], lines[i + 1])) {
      const lvl = UNDERLINE_LEVEL[lines[i + 1].trim()[0]] ?? 2;
      if (lvl < minLevel) minLevel = lvl;
    }
  }
  const levelOffset = Number.isFinite(minLevel) ? minLevel - 1 : 0;

  const out: string[] = [];
  let inMenu = false;
  let menuSeenEntry = false;
  let sawHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Menu handling ────────────────────────────────────────────
    if (/^\* Menu:/.test(line)) {
      inMenu = true;
      menuSeenEntry = false;
      continue; // drop the "* Menu:" marker; the bullets follow
    }
    if (inMenu) {
      if (/^\* /.test(line)) {
        out.push(convertMenuEntry(line));
        menuSeenEntry = true;
        continue;
      }
      if (line.trim() === "") {
        // A blank line AFTER at least one entry terminates the menu —
        // this is what separates the menu from a following indented
        // code block (which must not be swallowed as a continuation).
        if (menuSeenEntry) inMenu = false;
        out.push("");
        continue;
      }
      if (menuSeenEntry && /^\s/.test(line)) {
        // Wrapped menu-entry description (no intervening blank line) —
        // append to the previous bullet.
        const prev = out.pop() ?? "";
        out.push(`${prev} ${line.trim()}`.trimEnd());
        continue;
      }
      inMenu = false;
      // fall through to normal handling for this line
    }

    // ── Setext underline → ATX heading ───────────────────────────
    const next = lines[i + 1];
    if (line.trim() !== "" && next !== undefined && isUnderline(line, next)) {
      const raw = UNDERLINE_LEVEL[next.trim()[0]] ?? 2;
      const level = Math.min(6, Math.max(1, raw - levelOffset));
      const title = line.trim().replace(/^[\d]+(?:\.[\d]+)*\s+/, "");
      out.push(`${"#".repeat(level)} ${title}`);
      out.push("");
      sawHeading = true;
      i++; // consume the underline line
      continue;
    }

    out.push(line);
  }

  let md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Guarantee a leading H1 so the search indexer has a title.
  if (!sawHeading || !/^#{1,6}\s/.test(md)) {
    md = `# ${titleFromId(node.id)}\n\n${md}`;
  }

  return md + "\n";
}

/**
 * True when `under` is a texinfo heading underline for `title`: a line
 * made of a single repeated punctuation char from UNDERLINE_LEVEL,
 * length within ±2 of the (trimmed) title length.
 */
function isUnderline(title: string, under: string): boolean {
  const u = under.trim();
  if (u.length < 3) return false;
  const ch = u[0];
  if (!(ch in UNDERLINE_LEVEL)) return false;
  if (u !== ch.repeat(u.length)) return false;
  const t = title.trim().length;
  return Math.abs(u.length - t) <= 2;
}

/**
 * Convert a menu entry line to a markdown bullet link.
 *   `* node::            Description`   → `- [Description](node.md)`
 *   `* Label: node.      Description`   → `- [Label](node.md) — Description`
 *   `* node::`                          → `- [node](node.md)`
 */
function convertMenuEntry(line: string): string {
  // Cross-manual ref: `* label: (file)node.` — keep label as plain text.
  const xmanual = line.match(/^\*\s+([^:]+):\s*\(([^)]+)\)([^.]*)\.\s*(.*)$/);
  if (xmanual) {
    const label = xmanual[1].trim();
    const desc = xmanual[4].trim();
    return desc ? `- ${label} — ${desc}` : `- ${label}`;
  }
  // `* label: node.   desc`
  const labelled = line.match(/^\*\s+([^:]+):\s*([A-Za-z0-9._-]+)\.\s*(.*)$/);
  if (labelled) {
    const label = labelled[1].trim();
    const node = labelled[2].trim();
    const desc = labelled[3].trim();
    const link = `[${label}](${nodeSlug(node)}.md)`;
    return desc ? `- ${link} — ${desc}` : `- ${link}`;
  }
  // `* node::   desc`
  const direct = line.match(/^\*\s+([^:]+)::\s*(.*)$/);
  if (direct) {
    const node = direct[1].trim();
    const desc = direct[2].trim();
    const text = desc || node;
    return `- [${text}](${nodeSlug(node)}.md)`;
  }
  // Unrecognised — strip the leading `* ` so it doesn't read as a stray
  // markdown bullet pointing nowhere.
  return `- ${line.replace(/^\*\s+/, "").trim()}`;
}

/**
 * Convert inline `*note` cross-references to markdown links.
 *   `*note label: node.`  → `[label](node.md)`
 *   `*note node::`         → `[node](node.md)`
 * Case-insensitive on the `*note` / `*Note` marker.
 */
function convertInlineRefs(body: string): string {
  let s = body;
  // `*note label: node.` / `*note label: node,` — the trailing `.`/`,`
  // is texinfo's xref delimiter which doubles as sentence punctuation in
  // running text, so it is preserved after the link. The label may wrap
  // across a newline and contain spaces but never `:` or `*`; node is a
  // single slug token. `*Note*:` (bold "Note") has no whitespace before
  // the colon, so `\s+` keeps this from matching it.
  s = s.replace(
    /\*[Nn]ote\s+([^:*]+?):\s*([A-Za-z0-9._-]+)([.,])/g,
    (_m, label: string, node: string, term: string) =>
      `[${label.replace(/\s+/g, " ").trim()}](${nodeSlug(node)}.md)${term}`,
  );
  // `*note node::` (display-less form; node token may wrap)
  s = s.replace(
    /\*[Nn]ote\s+([A-Za-z0-9._\-\s]+?)::/g,
    (_m, node: string) => {
      const n = node.replace(/\s+/g, "").trim();
      return `[${n}](${nodeSlug(n)}.md)`;
    },
  );
  return s;
}

/** `string-functions` → `String Functions`. */
function titleFromId(id: string): string {
  if (id === "Top") return "MySQL Reference Manual";
  return id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
