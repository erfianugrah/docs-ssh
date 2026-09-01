import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";

/**
 * Converts TRaSH-Guides MkDocs source into resolved markdown.
 *
 * The upstream docs are authored with four MkDocs preprocessing layers
 * that leave raw directives in the committed markdown (each is useless
 * to a search corpus unless resolved):
 *
 *   1. pymdownx.snippets     `--8<-- "includes/foo.md"`       base: repo root
 *   2. include-markdown      `{! include-markdown "p" !}`     base: current file dir
 *   3. mkdocs-macros         `[[% include 'json/...' %]]`     base: docs_dir
 *                            `[[% filter indent(width=N) %]]`
 *   4. markdownextradata     `{{ sonarr['naming'][...] }}`    Jinja2 lookups
 *                            against `docs/json/` data files
 *
 * This converter resolves 1-4 against the on-disk checkout, matching the
 * resolution semantics of each upstream plugin (verified against the
 * plugin sources). The two Guide-Sync pages use full Jinja control-flow
 * templates (`{% for %}`, macros) over the data namespace; those are
 * batch-rendered through a bundled Python + Jinja2 helper (see
 * `renderJinjaBatch`) because they use Python object semantics
 * (`.split()`, `.get()`, `namespace()`, string `in`) that no JS template
 * engine supports.
 *
 * Lives in the ingestor layer (like `asciidoc-converter.ts`) because the
 * data files and `includes/` tree live outside the `docs/` walk and are
 * not part of the served DocSet.
 */

export interface ConvertedFile {
  path: string;
  content: string;
}

type DataNode = Record<string, unknown>;

const MAX_DEPTH = 10;
const DATA_EXTENSIONS = new Set(["json", "yml", "yaml"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

interface ConvertContext {
  cloneDir: string;
  docsDir: string;
  dataDir: string;
  data: DataNode;
}

export async function convertTrashGuides(cloneDir: string): Promise<ConvertedFile[]> {
  const docsDir = path.join(cloneDir, "docs");
  const dataDir = path.join(docsDir, "json");

  const data = await loadDataNamespace(dataDir);
  const ctx: ConvertContext = { cloneDir, docsDir, dataDir, data };

  const mdFiles = await walkFiles(docsDir, MARKDOWN_EXTENSIONS);
  const out: ConvertedFile[] = [];

  for (const relPath of mdFiles) {
    const full = path.join(docsDir, relPath);
    const raw = fs.readFileSync(full, "utf-8");
    out.push({ path: relPath, content: resolveDirectives(raw, full, ctx, 0) });
  }

  // Full-Jinja pages (the two Guide-Sync tables) are batch-rendered through
  // a bundled Python + Jinja2 helper, faithful to markdownextradata
  // (including the Python method calls / namespace / macros the templates
  // rely on). A missing python3/jinja2 degrades gracefully to raw templates.
  const fullRenderIdxs: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i].content.includes("{%")) fullRenderIdxs.push(i);
  }
  if (fullRenderIdxs.length > 0) {
    const rendered = renderJinjaBatch(
      fullRenderIdxs.map((i) => out[i].content),
      data,
    );
    if (rendered) {
      fullRenderIdxs.forEach((idx, j) => {
        out[idx].content = rendered[j];
      });
    }
  }

  return out;
}

// ─── markdownextradata data namespace ───────────────────────────────────

/**
 * Load `docs/json/**` into a nested object mirroring markdownextradata's
 * `on_pre_build`: the namespace for a file is its path relative to the
 * data dir, extension stripped, each path segment a nesting level (so
 * `sonarr/naming/sonarr-naming.json` → `data.sonarr.naming["sonarr-naming"]`).
 */
async function loadDataNamespace(dataDir: string): Promise<DataNode> {
  const root: DataNode = {};
  if (!fs.existsSync(dataDir)) return root;

  for (const rel of await walkFiles(dataDir, DATA_EXTENSIONS)) {
    const full = path.join(dataDir, rel);
    const raw = fs.readFileSync(full, "utf-8");
    let parsed: unknown;
    if (rel.toLowerCase().endsWith(".json")) {
      parsed = JSON.parse(raw);
    } else {
      parsed = parseYaml(raw);
    }
    const namespace = rel.replace(/\.(json|ya?ml)$/i, "").split(path.sep);
    setNamespace(root, namespace, parsed);
  }
  return root;
}

function setNamespace(root: DataNode, namespace: string[], value: unknown): void {
  let holder = root;
  for (let i = 0; i < namespace.length - 1; i++) {
    const key = namespace[i];
    if (!holder[key] || typeof holder[key] !== "object") {
      holder[key] = {};
    }
    holder = holder[key] as DataNode;
  }
  holder[namespace[namespace.length - 1]] = value;
}

// ─── directive resolution ───────────────────────────────────────────────

function resolveDirectives(
  content: string,
  currentFileAbs: string,
  ctx: ConvertContext,
  depth: number,
): string {
  if (depth >= MAX_DEPTH) return content;

  // 1. pymdownx.snippets - `--8<-- "path"` / `--8<-- 'path'`, path relative to repo root.
  content = content.replace(/--8<--\s*(?:"([^"]+)"|'([^']+)')\s*/g, (_m, dq: string, sq: string) => {
    const full = path.resolve(ctx.cloneDir, dq ?? sq);
    if (!within(full, ctx.cloneDir)) return "";
    return readAndResolve(full, ctx, depth);
  });

  // 2. include-markdown - `{! include-markdown "path" !}` / `'path'`, relative
  //    paths resolve against the including file's directory (verified against
  //    mkdocs-include-markdown-plugin directive.resolve_file_paths_to_include).
  content = content.replace(/\{!\s*include-markdown\s*(?:"([^"]+)"|'([^']+)')\s*!\}/g, (_m, dq: string, sq: string) => {
    const p = dq ?? sq;
    const base = p.startsWith(".") ? path.dirname(currentFileAbs) : ctx.docsDir;
    const full = path.resolve(base, p);
    if (!within(full, ctx.cloneDir)) return "";
    return readAndResolve(full, ctx, depth);
  });

  // 3. mkdocs-macros include - `[[% include 'path' %]]`, path relative to docs_dir.
  content = content.replace(/\[\[%\s*include\s*'([^']+)'\s*%\]\]/g, (_m, p: string) => {
    const full = path.resolve(ctx.docsDir, p);
    if (!within(full, ctx.docsDir)) return "";
    return readAndResolve(full, ctx, depth);
  });

  // 4. mkdocs-macros filter - `[[% filter indent(width=N) %]]...[[% endfilter %]]`
  //    (jinja `indent` filter, defaults first=False, blank=False).
  content = content.replace(
    /\[\[%\s*filter\s+indent\(width=(\d+)\)\s*%\]\]\s*([\s\S]*?)\s*\[\[%\s*endfilter\s*%\]\]/g,
    (_m, widthStr: string, body: string) => indent(body, parseInt(widthStr, 10)),
  );

  // 5. markdownextradata. Pages containing `{%` (the two Guide-Sync
  //    tables) are full Jinja templates - leave them untouched here and
  //    batch-render them through real Jinja2 in convertTrashGuides. Plain
  //    `{{ }}` lookups resolve in-place against the data namespace.
  if (content.includes("{%")) return content;
  content = resolveJinja(content, ctx);

  return content;
}

function readAndResolve(full: string, ctx: ConvertContext, depth: number): string {
  if (!fs.existsSync(full)) return "";
  return resolveDirectives(fs.readFileSync(full, "utf-8"), full, ctx, depth + 1);
}

/** True if `p` resolves to a file strictly inside `root` (no traversal). */
function within(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** jinja `indent` filter: indent every line except the first and blanks. */
function indent(body: string, width: number): string {
  const pad = " ".repeat(width);
  return body
    .split("\n")
    .map((line, i) => (i === 0 || line.trim() === "" ? line : pad + line))
    .join("\n");
}

// ─── markdownextradata `{{ }}` substitution ─────────────────────────────

const JINJA_RENDERER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "jinja-render.py",
);

function jinja2Available(): boolean {
  try {
    execFileSync("python3", ["-c", "import jinja2"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Render full Jinja2 templates (the Guide-Sync `{% for %}` tables) through
 * a bundled Python + Jinja2 helper. Returns null when python3/jinja2 is
 * unavailable or rendering fails, so callers keep the raw templates - a
 * missing optional renderer must not fail the whole source.
 */
function renderJinjaBatch(templates: string[], data: DataNode): string[] | null {
  if (!jinja2Available()) {
    console.warn("  [trash-guides] python3+jinja2 unavailable - leaving {% %} templates unresolved");
    return null;
  }
  try {
    const stdout = execFileSync("python3", [JINJA_RENDERER], {
      input: JSON.stringify({ templates, data }),
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed) || parsed.length !== templates.length) {
      throw new Error(
        `jinja-render returned ${Array.isArray(parsed) ? parsed.length : "non-array"} results for ${templates.length} templates`,
      );
    }
    return parsed as string[];
  } catch (err) {
    console.warn(`  [trash-guides] jinja render failed, leaving templates raw: ${(err as Error).message}`);
    return null;
  }
}

const JINJA_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function resolveJinja(content: string, ctx: ConvertContext): string {
  return content.replace(JINJA_RE, (match, expr: string) => {
    const resolved = resolveLookup(expr.trim(), ctx.data);
    return resolved === undefined ? match : resolved;
  });
}

/**
 * Resolve a lookup chain like `sonarr['naming']['sonarr-naming']['series']['default']`
 * or `sonarr['quality-size']['series']['qualities'][13]['max']` against the
 * data namespace. Returns undefined when the expression is not a pure
 * `root['k']['k']...[i]` chain (e.g. a `{% %}` loop variable) or a key is
 * missing - callers leave the original token in place in that case.
 */
function resolveLookup(expr: string, data: DataNode): string | undefined {
  const rootMatch = expr.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
  if (!rootMatch) return undefined;

  let current: unknown = data[rootMatch[1]];
  if (current === undefined) return undefined;

  const rest = expr.slice(rootMatch[1].length);
  const accessorRe = /\['([^']*)'\]|\[(\d+)\]/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = accessorRe.exec(rest)) !== null) {
    if (m.index !== pos) return undefined; // non-accessor token in the chain
    pos = accessorRe.lastIndex;
    if (current == null || typeof current !== "object") return undefined;
    const key = m[1] !== undefined ? m[1] : String(parseInt(m[2], 10));
    current = (current as DataNode)[key];
  }
  if (pos !== rest.length) return undefined; // trailing garbage after the chain

  if (current === undefined || current === null || typeof current === "object") {
    return undefined;
  }
  return String(current);
}

// ─── file walking ───────────────────────────────────────────────────────

async function walkFiles(dir: string, extensions: Set<string>): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string, base: string): Promise<void> {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, base);
      } else if (entry.isFile()) {
        const ext = entry.name.split(".").pop() ?? "";
        if (extensions.has(ext)) {
          out.push(path.relative(base, full));
        }
      }
    }
  }

  await walk(dir, dir);
  return out;
}
