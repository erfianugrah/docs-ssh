import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { DocFile } from "../domain/DocFile.js";
import { DocSet } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource } from "../domain/DocSource.js";
import { walkDir } from "../shared/walkDir.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

/** Timeout for heavy git operations (clone, pull) */
const GIT_CLONE_TIMEOUT = 120_000;
/** Timeout for lightweight git operations (checkout, sparse-checkout, rev-parse) */
const GIT_FAST_TIMEOUT = 30_000;

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
      const sparseArgs =
        source.paths.length > 0
          ? ["--no-checkout", "--filter=blob:none"]
          : ["--depth", "1"];
      execFileSync("git", ["clone", ...sparseArgs, source.url, cloneDir], {
        stdio: "pipe",
        timeout: GIT_CLONE_TIMEOUT,
      });

      if (source.paths.length > 0) {
        execFileSync("git", ["sparse-checkout", "init", "--cone"], {
          cwd: cloneDir,
          stdio: "pipe",
          timeout: GIT_FAST_TIMEOUT,
        });
        execFileSync("git", ["sparse-checkout", "set", ...source.paths], {
          cwd: cloneDir,
          stdio: "pipe",
          timeout: GIT_FAST_TIMEOUT,
        });
        execFileSync("git", ["checkout"], {
          cwd: cloneDir,
          stdio: "pipe",
          timeout: GIT_FAST_TIMEOUT,
        });
      }
    } else {
      // Pull latest
      execFileSync("git", ["pull", "--rebase"], {
        cwd: cloneDir,
        stdio: "pipe",
        timeout: GIT_CLONE_TIMEOUT,
      });
    }

    // Get current HEAD SHA for versioning
    let version: string | undefined;
    try {
      version = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: cloneDir,
        timeout: GIT_FAST_TIMEOUT,
      }).toString().trim();
    } catch {
      // non-fatal
    }

    // Determine which directories to scan
    const scanRoots =
      source.paths.length > 0
        ? source.paths.map((p) => path.join(cloneDir, p))
        : [cloneDir];

    // Build a path transformer that strips the rootPath prefix
    const rootPath = source.rootPath;
    const pathTransform = rootPath
      ? (relativePath: string) => {
          const prefix = rootPath.endsWith("/") ? rootPath : rootPath + "/";
          return relativePath.startsWith(prefix)
            ? relativePath.slice(prefix.length)
            : relativePath;
        }
      : undefined;

    const files = new Map<string, DocFile>();

    for (const root of scanRoots) {
      const rootExists = await exists(root);
      if (!rootExists) continue;
      await walkDir(root, cloneDir, files, {
        extensions: MARKDOWN_EXTENSIONS,
        pathTransform,
      });
    }

    return new DocSet(source, files, new Date(), version);
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
