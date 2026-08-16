import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DocFile } from "../domain/DocFile.js";
import { DocSet } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocSource } from "../domain/DocSource.js";
import { walkDir } from "../shared/walkDir.js";
import { retryWithBackoff, type RetryOptions } from "../shared/retry.js";

const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set(["txt"]);

/** Full-corpus rsync (~560MB, 10k files for the RFC module) - allow slow links. */
const RSYNC_TIMEOUT = 15 * 60_000;

/** Default retry options for the network rsync. */
const DEFAULT_RETRY_OPTS: RetryOptions = { retries: 2, base: 1000 };

/**
 * Ingestor for rsync-module doc sources. Exists for the RFC Editor's
 * `rsync.rfc-editor.org::rfcs-text-only` module - the only sanctioned bulk
 * channel for the full RFC corpus (the web site's RFC-all tarball was
 * retired; page-by-page HTTP scraping of ~10k documents is neither polite
 * nor fast). rsync is incremental, so warm runs against a persistent work
 * dir transfer only new/changed files.
 *
 * `source.url` is the rsync module spec (host::module) or a local path
 * (used by tests).
 */
export class RsyncIngestor implements DocIngestor {
  readonly name = "RsyncIngestor";
  private readonly retryOpts: RetryOptions;

  constructor(retryOpts: RetryOptions = DEFAULT_RETRY_OPTS) {
    this.retryOpts = retryOpts;
  }

  supports(source: DocSource): boolean {
    return source.type === "rsync";
  }

  async ingest(source: DocSource, workDir: string, signal?: AbortSignal): Promise<DocSet> {
    const targetDir = path.join(workDir, source.name);
    await fs.mkdir(targetDir, { recursive: true });

    if (signal?.aborted) {
      throw new Error(`rsync ingest aborted: ${signal.reason ?? "deadline exceeded"}`);
    }

    console.log(`  [${source.name}] rsync ${source.url} ...`);
    await retryWithBackoff(
      () =>
        execFileAsync(
          "rsync",
          // -a: recursive + preserve attrs; -z: compress; --delete: mirror
          // upstream removals; -L: materialise symlinks (the module carries
          // ~290, and walkDir's isFile() filter would skip them).
          ["-azL", "--delete", `${source.url}/`, `${targetDir}/`],
          { timeout: RSYNC_TIMEOUT, signal, maxBuffer: 16 * 1024 * 1024 },
        ),
      {
        ...this.retryOpts,
        onRetry: (_a, err, delay) => {
          const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
          console.warn(`  [retry] rsync ${source.url} -> ${msg}, waiting ${Math.round(delay)}ms...`);
        },
      },
    );

    const collected = new Map<string, DocFile>();
    await walkDir(targetDir, targetDir, collected, { extensions: TEXT_EXTENSIONS });

    // Same path filtering convention as the texinfo ingestor.
    const files = new Map<string, DocFile>();
    for (const [filePath, file] of collected) {
      if (source.urlPattern && !new RegExp(source.urlPattern).test(filePath)) continue;
      if (source.urlExclude && new RegExp(source.urlExclude).test(filePath)) continue;
      files.set(filePath, file);
    }

    console.log(`  [${source.name}] collected ${files.size} text files`);
    return new DocSet(source, files, new Date());
  }
}
