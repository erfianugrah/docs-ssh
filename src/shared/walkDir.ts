import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DocFile } from "../domain/DocFile.js";

export interface WalkDirOptions {
  /** Only include files whose extension is in this set. If undefined, include all files. */
  extensions?: ReadonlySet<string>;
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
      // Extension filter
      if (options?.extensions) {
        const ext = entry.name.split(".").pop() ?? "";
        if (!options.extensions.has(ext)) continue;
      }

      const content = await fs.readFile(fullPath, "utf-8");
      let relativePath = path.relative(root, fullPath);

      if (options?.pathTransform) {
        relativePath = options.pathTransform(relativePath);
      }

      files.set(relativePath, new DocFile(relativePath, content));
    }
  }
}
