import { DocFile } from "../domain/DocFile.js";

/**
 * Resolves Supabase `<$Partial path="..." />` transclusion directives by
 * inlining the referenced partial's content into the host page.
 *
 * This is a CROSS-FILE transform — it needs the whole file map to look up
 * partials — so it cannot be a per-file DocNormaliser (which only sees one
 * file). It runs as a DocSet-level pre-pass in UpdateDocSets.normalise,
 * BEFORE per-file normalisation, so the inlined raw MDX is cleaned together
 * with its host page by the MdxNormaliser/MarkdownCleaner passes.
 *
 * Mirrors the canonical resolver at
 * apps/docs/content → features/directives/Partial.ts in supabase/supabase:
 * - Paths are relative to the `_partials/` directory (leading `/` tolerated).
 * - `variables={{ "k": "v" }}` performs `{{ .k }}` → value substitution;
 *   unprovided placeholders render empty; `\{{ .x }}` opts out.
 * - Nested partials (a partial that includes another) are resolved
 *   recursively, bounded by MAX_DEPTH to defend against cycles.
 *
 * After resolution, all `_partials/**` files are dropped from the returned
 * map — they are transclusion fragments, not standalone pages, and serving
 * them produces context-free search noise.
 */

const PARTIALS_DIR = "_partials";
const MAX_DEPTH = 10;

/** Match a self-closing `<$Partial ... />` directive (single- or multi-line). */
const PARTIAL_RE = /<\$Partial\b([\s\S]*?)\/>/g;

/** Resolve `<$Partial>` directives across the whole file map. */
export function resolvePartials(
  files: ReadonlyMap<string, DocFile>,
): Map<string, DocFile> {
  const out = new Map<string, DocFile>();

  for (const [path, file] of files) {
    // Drop partials themselves from the served set.
    if (isPartialPath(path)) continue;

    if (!file.content.includes("<$Partial")) {
      out.set(path, file);
      continue;
    }

    const resolved = resolveContent(file.content, files, 0);
    out.set(path, file.withContent(resolved));
  }

  return out;
}

/** True if a DocSet-relative path lives under the `_partials/` directory. */
function isPartialPath(path: string): boolean {
  return path === PARTIALS_DIR || path.startsWith(`${PARTIALS_DIR}/`);
}

/** Recursively inline every `<$Partial>` directive found in `content`. */
function resolveContent(
  content: string,
  files: ReadonlyMap<string, DocFile>,
  depth: number,
): string {
  if (depth >= MAX_DEPTH) {
    // Defensive: strip remaining directives rather than recurse forever.
    return content.replace(PARTIAL_RE, "");
  }

  return content.replace(PARTIAL_RE, (_match, attrs: string) => {
    const rawPath = extractAttr(attrs, "path");
    if (!rawPath || !isMdFile(rawPath)) return "";

    const key = resolveKey(rawPath);
    if (!key) return ""; // traversal attempt — drop

    const partial = files.get(key);
    if (!partial) return ""; // missing partial — drop the directive

    const vars = extractVariables(attrs);
    let body = stripFrontmatter(partial.content).trim();
    body = substituteVars(body, vars);

    // Recurse: the partial may itself contain `<$Partial>` directives.
    return resolveContent(body, files, depth + 1);
  });
}

/** Extract a quoted attribute value (`name="..."` or `name='...'`). */
function extractAttr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*['"]([^'"]+)['"]`));
  return m?.[1];
}

/**
 * Extract the `variables={{ ... }}` JSON object. The outer `{` is the JSX
 * expression container; the inner `{...}` is a flat string→string object
 * literal (the canonical resolver rejects non-string values), so the first
 * `}` reliably closes it.
 */
function extractVariables(attrs: string): Record<string, string> {
  const m = attrs.match(/variables\s*=\s*\{\s*(\{[\s\S]*?\})\s*\}/);
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[1]);
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Substitute `{{ .key }}` placeholders. Provided keys are replaced with their
 * value; any remaining `{{ .x }}` is cleared (renders empty in the real app);
 * a leading backslash (`\{{ .x }}`) opts the placeholder out of substitution.
 */
function substituteVars(content: string, vars: Record<string, string>): string {
  for (const [key, value] of Object.entries(vars)) {
    content = content.replace(
      new RegExp(`(?<!\\\\)\\{\\{\\s*\\.${escapeRe(key)}\\s*\\}\\}`, "g"),
      value,
    );
  }
  // Clear unprovided placeholders.
  content = content.replace(/(?<!\\)\{\{\s*\.[\w-]+\s*\}\}/g, "");
  return content;
}

/**
 * Resolve a directive `path` to a DocSet-relative map key under `_partials/`.
 * Returns undefined if the normalised path escapes `_partials/` (traversal).
 */
function resolveKey(rawPath: string): string | undefined {
  const rel = rawPath.replace(/^\/+/, "");
  const segments: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return undefined; // escapes _partials/
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  if (segments.length === 0) return undefined;
  return `${PARTIALS_DIR}/${segments.join("/")}`;
}

function isMdFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdx");
}

/** Strip leading YAML frontmatter so an inlined partial doesn't leak a `---` block mid-page. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, "");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
