import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DocFile } from "../domain/DocFile.js";

/** Filenames to skip — non-doc metadata files common in git repos. */
const SKIP_FILENAMES = new Set([
  "config.json", "_category_.json", "sidebars.js", "sidebars.json",
  "docusaurus.config.js", "docusaurus.config.ts", "mkdocs.yml", "book.toml",
  ".gitignore", ".editorconfig", "LICENSE", "LICENSE.md",
]);

export interface WalkDirOptions {
  /** Only include files whose extension is in this set. If undefined, include all files. */
  extensions?: ReadonlySet<string>;
  /**
   * Additional per-filename skip predicate (applied after the static
   * SKIP_FILENAMES set and the extension filter). Useful for skipping
   * generated / test files identified by a pattern rather than a
   * fixed name (e.g. `*_test.go`, `z*.go` in Go sources).
   */
  skipFile?: (basename: string) => boolean;
  /** Transform the relative path before storing. Receives the path relative to `root`. */
  pathTransform?: (relativePath: string) => string;
}

/**
 * Recursively walks a directory, collecting files into a Map keyed by relative path.
 *
 * @param dir       The current directory being walked
 * @param root      The root directory (used to compute relative paths)
 * @param files     The accumulator map to populate
 * @param options   Optional filtering and path transformation
 */
export async function walkDir(
  dir: string,
  root: string,
  files: Map<string, DocFile>,
  options?: WalkDirOptions,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, root, files, options);
    } else if (entry.isFile()) {
      // Skip non-doc metadata files
      if (SKIP_FILENAMES.has(entry.name)) continue;

      // Extension filter
      if (options?.extensions) {
        const ext = entry.name.split(".").pop() ?? "";
        if (!options.extensions.has(ext)) continue;
      }

      // Per-filename skip predicate (for *_test.go, z*.go, etc.)
      if (options?.skipFile?.(entry.name)) continue;

      const content = await fs.readFile(fullPath, "utf-8");
      let relativePath = path.relative(root, fullPath);

      if (options?.pathTransform) {
        relativePath = options.pathTransform(relativePath);
      }

      files.set(relativePath, new DocFile(relativePath, content));
    }
  }
}
