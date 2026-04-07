import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { DocFile } from "../domain/DocFile.js";
import { DocSet } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource } from "../domain/DocSource.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

/**
 * Ingestor for git-based doc sources.
 * Uses sparse-checkout to fetch only the required paths,
 * keeping clone size small.
 */
export class GitIngestor implements DocIngestor {
  readonly name = "GitIngestor";

  supports(source: DocSource): boolean {
    return source.type === "git";
  }

  async ingest(source: DocSource, workDir: string): Promise<DocSet> {
    const cloneDir = path.join(workDir, source.name);

    // Clone with sparse checkout if paths are specified
    if (!(await exists(cloneDir))) {
      const sparseArgs = source.paths.length > 0 ? "--no-checkout --filter=blob:none" : "--depth 1";
      execSync(`git clone ${sparseArgs} ${source.url} ${cloneDir}`, { stdio: "pipe" });

      if (source.paths.length > 0) {
        execSync("git sparse-checkout init --cone", { cwd: cloneDir, stdio: "pipe" });
        execSync(`git sparse-checkout set ${source.paths.join(" ")}`, {
          cwd: cloneDir,
          stdio: "pipe",
        });
        execSync("git checkout", { cwd: cloneDir, stdio: "pipe" });
      }
    } else {
      // Pull latest
      execSync("git pull --rebase", { cwd: cloneDir, stdio: "pipe" });
    }

    // Get current HEAD SHA for versioning
    let version: string | undefined;
    try {
      version = execSync("git rev-parse --short HEAD", { cwd: cloneDir }).toString().trim();
    } catch {
      // non-fatal
    }

    // Determine which directories to scan
    const scanRoots =
      source.paths.length > 0
        ? source.paths.map((p) => path.join(cloneDir, p))
        : [cloneDir];

    const files = new Map<string, DocFile>();

    for (const root of scanRoots) {
      const rootExists = await exists(root);
      if (!rootExists) continue;
      await walkDir(root, cloneDir, source.rootPath, files);
    }

    return new DocSet(source, files, new Date(), version);
  }
}

async function walkDir(
  dir: string,
  cloneRoot: string,
  rootPath: string | undefined,
  files: Map<string, DocFile>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, cloneRoot, rootPath, files);
    } else if (entry.isFile()) {
      const ext = entry.name.split(".").pop() ?? "";
      if (!MARKDOWN_EXTENSIONS.has(ext)) continue;

      const content = await fs.readFile(fullPath, "utf-8");

      // Build relative path, optionally stripping the rootPath prefix
      let relativePath = path.relative(cloneRoot, fullPath);
      if (rootPath) {
        const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
        if (relativePath.startsWith(prefix)) {
          relativePath = relativePath.slice(prefix.length);
        }
      }

      files.set(relativePath, new DocFile(relativePath, content));
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
