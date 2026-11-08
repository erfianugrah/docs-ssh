import { DocFile } from "../domain/DocFile.js";

/**
 * Resolves Docusaurus MDX `import`-style partial transclusions by inlining
 * the referenced partial's content into the host page and dropping the
 * partial files from the served set.
 *
 * Pattern:
 *   import ComposeBuilder from '/docs/partials/_compose-builder.mdx';
 *   ...
 *   <ComposeBuilder />
 *
 * Local partial files (basename starting with `_`) are inlined; external
 * package imports (`@theme/Tabs`, `@mdi/react`, `!!raw-loader!...`) are
 * left untouched - MdxNormaliser strips those.
 *
 * This is a CROSS-FILE transform - it needs the whole file map to look up
 * partials - so it runs as a DocSet-level pre-pass in
 * UpdateDocSets.normalise, BEFORE per-file normalisation, so the inlined
 * raw MDX is cleaned together with its host page by the
 * MdxNormaliser/MarkdownCleaner passes.
 *
 * After resolution, all partial files (basename starting with `_`) are
 * dropped from the returned map - they are transclusion fragments, not
 * standalone pages.
 *
 * Opposite of resolvePartials.ts (which handles the supabase
 * `<$Partial path="..." />` syntax). A source picks one or the
 * other - never both.
 */

const MAX_DEPTH = 10;

/** Match `import Name from 'path'` - single-line, default import only. */
const IMPORT_RE = /^import\s+(\w[\w$]*)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

/** Capture a self-closing or paired JSX tag for a component name. */
function tagRe(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `<${escaped}(\\s[^>]*)?\\/>|<${escaped}(\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`,
    "g",
  );
}

/** True if a file's basename starts with `_` (partial convention). */
function isPartialFile(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return base.startsWith("_");
}

/**
 * True if an import source is a local path (Docusaurus site-absolute or page-relative)
 * rather than an external package (`@scope/...`, `!!raw-loader!...`).
 */
function isLocalImport(source: string): boolean {
  if (source.startsWith("@") || source.startsWith("!!")) return false;
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) return true;
  return false;
}

/**
 * Resolve a local import path to a DocSet file-map key.
 *
 * Docusaurus absolute imports (`/docs/path/to/file.mdx`) map to a key
 * relative to the content root (`rootPath`). The leading path segment
 * (commonly `/docs/`) is the Docusaurus routeBasePath and is stripped.
 *
 * Relative imports (`./foo.mdx`, `../bar.mdx`) resolve against the
 * importing file's directory.
 *
 * Returns undefined if the resolved path escapes the source root or
 * doesn't exist in the file map.
 */
function resolveLocalImport(
  importPath: string,
  importerRelPath: string,
  files: ReadonlyMap<string, DocFile>,
): string | undefined {
  if (importPath.startsWith("/")) {
    // Absolute import: try stripping the first path segment (routeBasePath,
    // typically `/docs/`). Also try the full path as-is relative to root.
    const trimmed = importPath.replace(/^\/[^/]+\//, "");
    if (files.has(trimmed)) return trimmed;

    // Also try without the leading slash (just in case rootPath was flat).
    const slashless = importPath.replace(/^\//, "");
    if (files.has(slashless)) return slashless;

    return undefined;
  }

  // Relative import: resolve against the importing file's directory.
  const importerDir = importerRelPath.includes("/")
    ? importerRelPath.substring(0, importerRelPath.lastIndexOf("/"))
    : "";

  const segments = importerDir ? importerDir.split("/") : [];
  const relSegments = importPath.split("/");
  for (const seg of relSegments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segments.length === 0) return undefined; // escapes root
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  const resolved = segments.join("/");
  if (files.has(resolved)) return resolved;
  return undefined;
}

/**
 * Analyse each file: extract local `import Name from 'path'` bindings
 * where the target is a partial file in the map. Returns a map of
 * host path → [{ name, content }] inlinings.
 */
function collectInlinings(
  files: ReadonlyMap<string, DocFile>,
): Map<string, { name: string; content: string }[]> {
  // Pass 1: cache all partial content (strip frontmatter).
  const partialCache = new Map<string, string>();
  for (const [path, file] of files) {
    if (isPartialFile(path)) {
      partialCache.set(path, stripFrontmatter(file.content).trim());
    }
  }

  // Pass 2: scan host files for local imports of partial files.
  const result = new Map<string, { name: string; content: string }[]>();
  for (const [path, file] of files) {
    if (isPartialFile(path)) continue;

    const inlinings: { name: string; content: string }[] = [];
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(file.content)) !== null) {
      const name = m[1];
      const source = m[2];
      if (!isLocalImport(source)) continue;

      const key = resolveLocalImport(source, path, files);
      if (key && isPartialFile(key) && partialCache.has(key)) {
        inlinings.push({ name, content: partialCache.get(key)! });
      }
    }

    if (inlinings.length > 0) {
      result.set(path, inlinings);
    }
  }

  return result;
}

/** Strip leading YAML frontmatter so an inlined partial doesn't leak a `---` block mid-page. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, "");
}

/**
 * Resolve Docusaurus MDX import partials across the whole file map.
 *
 * @param files  The DocSet file map (keys relative to source rootPath).
 * @returns A new map with partials inlined and partial files dropped.
 */
export function resolveDocusaurusImports(
  files: ReadonlyMap<string, DocFile>,
): Map<string, DocFile> {
  const inlinings = collectInlinings(files);

  const out = new Map<string, DocFile>();
  for (const [path, file] of files) {
    // Drop partial files from the served set.
    if (isPartialFile(path)) continue;

    const imps = inlinings.get(path);
    if (!imps) {
      out.set(path, file);
      continue;
    }

    let content = file.content;

    // Strip import lines for resolved partials.
    for (const { name } of imps) {
      content = content.replace(
        new RegExp(`^import\\s+${name}\\s+from\\s+['"][^'"]+['"];?\\s*\\n`, "gm"),
        "",
      );
    }

    // Replace <Name /> and <Name></Name> with partial content.
    for (const { name, content: partialContent } of imps) {
      content = content.replace(tagRe(name), partialContent);
    }

    out.set(path, file.withContent(content));
  }

  return out;
}