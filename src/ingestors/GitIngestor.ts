import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DocFile } from "../domain/DocFile.js";

const execFileAsync = promisify(execFile);
import { DocSet } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource } from "../domain/DocSource.js";
import { walkDir } from "../shared/walkDir.js";
import { convertOpenApiToMarkdown } from "./openapi-converter.js";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const OPENAPI_FILENAMES = new Set(["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"]);

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

    // Clone with sparse-ready args if paths are specified, otherwise
    // shallow clone. Sparse config is applied below so it's idempotent
    // across runs — previously re-applying was skipped on existing
    // clones, so editing source.paths had no effect until the work dir
    // was wiped.
    if (!(await exists(cloneDir))) {
      const sparseArgs =
        source.paths.length > 0
          ? ["--no-checkout", "--filter=blob:none"]
          : ["--depth", "1"];
      await execFileAsync("git", ["clone", ...sparseArgs, source.url, cloneDir], {
        timeout: GIT_CLONE_TIMEOUT,
      });
    } else {
      // Pull latest
      await execFileAsync("git", ["pull", "--rebase"], {
        cwd: cloneDir,
        timeout: GIT_CLONE_TIMEOUT,
      });
    }

    // (Re-)apply sparse-checkout every run — idempotent when paths match
    // the stored config, and picks up changes to source.paths otherwise.
    if (source.paths.length > 0) {
      await execFileAsync("git", ["sparse-checkout", "init", "--cone"], {
        cwd: cloneDir,
        timeout: GIT_FAST_TIMEOUT,
      });
      await execFileAsync("git", ["sparse-checkout", "set", ...source.paths], {
        cwd: cloneDir,
        timeout: GIT_FAST_TIMEOUT,
      });
      await execFileAsync("git", ["checkout"], {
        cwd: cloneDir,
        timeout: GIT_FAST_TIMEOUT,
      });
    }

    // Get current HEAD SHA for versioning.
    // Use full 40-char SHA (not --short) so freshness checks in
    // UpdateDocSets.checkGitFreshness can compare byte-for-byte against
    // `git ls-remote` output. --short auto-disambiguates to 7-10 chars
    // for large repos, which never matches a sliced remote SHA.
    let version: string | undefined;
    try {
      version = (await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: cloneDir,
        timeout: GIT_FAST_TIMEOUT,
      })).stdout.trim();
    } catch {
      // non-fatal
    }

    // ─── openapi-dir: multi-spec conversion from a git repo ──────────
    if (source.discovery === "openapi-dir" && source.format === "openapi") {
      return this.ingestOpenApiDir(source, cloneDir, version);
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

  // ─── Multi-spec OpenAPI ingestion ──────────────────────────────────

  /**
   * Walks a git repo directory containing multiple OpenAPI specs (e.g.
   * APIs-guru/openapi-directory). For each service dir, finds the latest
   * version's spec file, converts it to markdown, and prefixes output
   * paths with the service name.
   */
  private async ingestOpenApiDir(
    source: DocSource,
    cloneDir: string,
    version: string | undefined,
  ): Promise<DocSet> {
    const rootDir = source.rootPath
      ? path.join(cloneDir, source.rootPath)
      : cloneDir;

    if (!(await exists(rootDir))) {
      throw new Error(`GitIngestor: openapi-dir root not found: ${rootDir}`);
    }

    // Build urlPattern filter regex
    const filterRe = source.urlPattern ? new RegExp(source.urlPattern) : undefined;

    // List service directories under rootDir
    const serviceDirs = await fs.readdir(rootDir, { withFileTypes: true });
    const files = new Map<string, DocFile>();
    const errors: string[] = [];

    for (const entry of serviceDirs) {
      if (!entry.isDirectory()) continue;
      const serviceName = entry.name;

      // Apply urlPattern filter against service dir name
      if (filterRe && !filterRe.test(serviceName)) continue;

      try {
        const specPath = await findLatestSpec(path.join(rootDir, serviceName));
        if (!specPath) {
          console.warn(`  [${source.name}] no spec found for ${serviceName}, skipping`);
          continue;
        }

        const raw = await fs.readFile(specPath, "utf-8");
        const specFiles = convertOpenApiToMarkdown(raw, serviceName);

        for (const sf of specFiles) {
          // Prefix with service name: lambda/api/overview.md
          const filePath = `${serviceName}/${sf.path}`;
          files.set(filePath, new DocFile(filePath, sf.content));
        }

        console.log(`  [${source.name}] ${serviceName}: ${specFiles.length} files`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${serviceName}: ${msg}`);
        console.warn(`  [${source.name}] failed to convert ${serviceName}: ${msg}`);
      }
    }

    if (files.size === 0 && errors.length > 0) {
      throw new Error(
        `GitIngestor: all openapi-dir conversions failed. First error: ${errors[0]}`,
      );
    }

    console.log(
      `  [${source.name}] converted ${files.size} files from ${files.size > 0 ? new Set([...files.keys()].map((k) => k.split("/")[0])).size : 0} services`,
    );
    return new DocSet(source, files, new Date(), version);
  }
}

/**
 * Find the latest versioned spec file under a service directory.
 * Structure: {serviceDir}/{version}/openapi.yaml (or .json, swagger.*)
 * Sorts version dirs lexicographically and picks the last (latest).
 */
async function findLatestSpec(serviceDir: string): Promise<string | undefined> {
  const entries = await fs.readdir(serviceDir, { withFileTypes: true });
  const versionDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // lexicographic sort — works for ISO dates and semver

  // Walk versions from latest to oldest, return first spec found
  for (let i = versionDirs.length - 1; i >= 0; i--) {
    const versionDir = path.join(serviceDir, versionDirs[i]);
    const versionEntries = await fs.readdir(versionDir);
    const specFile = versionEntries.find((f) => OPENAPI_FILENAMES.has(f));
    if (specFile) {
      return path.join(versionDir, specFile);
    }
  }

  // Also check for spec files directly in service dir (no version subdirs)
  const directEntries = await fs.readdir(serviceDir);
  const directSpec = directEntries.find((f) => OPENAPI_FILENAMES.has(f));
  if (directSpec) {
    return path.join(serviceDir, directSpec);
  }

  return undefined;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
