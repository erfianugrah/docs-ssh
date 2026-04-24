import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DocFile } from "../domain/DocFile.js";

const execFileAsync = promisify(execFile);
import { DocSet, type UpdateResult } from "../domain/DocSet.js";
import { walkDir } from "../shared/walkDir.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocSource, DocFormat } from "../domain/DocSource.js";

const FORMAT_VALUES: readonly DocFormat[] = ["html", "mdx", "markdown"];
const UA = "docs-ssh/0.8 (freshness-check; +https://github.com/erfianugrah/docs-ssh)";
const HEAD_TIMEOUT = 10_000;
const HEAD_RETRIES = 2;

/** HEAD request with retry on network errors. */
async function fetchHead(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= HEAD_RETRIES; attempt++) {
    try {
      return await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(HEAD_TIMEOUT),
      });
    } catch (err) {
      lastError = err;
      if (attempt < HEAD_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Returns true if the normaliser is a format converter (HTML→MD, MDX→MD) */
function isFormatConverter(n: DocNormaliser): boolean {
  return FORMAT_VALUES.some((f) => n.supportsFormat(f));
}

export interface UpdateDocSetsOptions {
  sources: readonly DocSource[];
  ingestors: readonly DocIngestor[];
  normalisers: readonly DocNormaliser[];
  outDir: string;
  workDir: string;
  /** Max parallel source fetches (default: 6) */
  concurrency?: number;
  /** Max age in seconds before re-checking freshness (default: 86400 = 24h, 0 = always refresh) */
  maxAge?: number;
}

export interface SourceResult {
  source: string;
  status: "ok" | "skipped" | "error";
  diff?: UpdateResult;
  version?: string;
  error?: string;
}

/** Persisted per-source freshness metadata. */
interface StampData {
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  gitSha?: string;
}

/**
 * Application service: orchestrates fetching, normalising and writing all DocSets.
 *
 * Sources are processed in parallel batches (configurable concurrency).
 * Each source checks remote freshness before re-fetching:
 *   - Git: `git ls-remote` to compare HEAD SHA
 *   - HTTP: HEAD request on discoveryUrl to compare ETag/Last-Modified
 *   - Fallback: timestamp-based maxAge
 */
// ─── Progress display (Docker-pull style) ─────────────────────────

interface ProgressLine {
  name: string;
  status: string;
  icon: string;
}

class BatchProgress {
  private lines: ProgressLine[] = [];
  private isTTY = process.stdout.isTTY ?? false;
  private rendered = false;
  private savedLog = console.log;
  private savedWarn = console.warn;
  private savedError = console.error;

  start(names: string[]) {
    this.lines = names.map((name) => ({ name, status: "waiting", icon: "○" }));
    if (this.isTTY) {
      // Suppress ingestor console noise — progress display replaces it
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const noop = () => {};
      console.log = noop;
      console.warn = noop;
      console.error = noop;
      this.render();
    }
  }

  update(name: string, status: string) {
    const line = this.lines.find((l) => l.name === name);
    if (line) {
      line.status = status;
      line.icon = "◌";
    }
    if (this.isTTY) this.render();
  }

  done(name: string, status: string) {
    const line = this.lines.find((l) => l.name === name);
    if (line) {
      line.status = status;
      line.icon = "✓";
    }
    if (this.isTTY) this.render();
  }

  error(name: string, status: string) {
    const line = this.lines.find((l) => l.name === name);
    if (line) {
      line.status = status;
      line.icon = "✗";
    }
    if (this.isTTY) this.render();
  }

  finish() {
    if (this.isTTY) {
      console.log = this.savedLog;
      console.warn = this.savedWarn;
      console.error = this.savedError;
    }
    this.rendered = false;
  }

  private render() {
    if (this.rendered) {
      process.stdout.write(`\x1b[${this.lines.length}A`);
    }
    for (const line of this.lines) {
      process.stdout.write(`\x1b[2K  ${line.icon} ${line.name.padEnd(22)} ${line.status}\n`);
    }
    this.rendered = true;
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────

export class UpdateDocSets {
  private readonly concurrency: number;
  private readonly maxAge: number;

  constructor(private readonly opts: UpdateDocSetsOptions) {
    this.concurrency = opts.concurrency ?? 6;
    this.maxAge = opts.maxAge ?? 86400;
  }

  async run(): Promise<SourceResult[]> {
    const results: SourceResult[] = [];
    const total = this.opts.sources.length;

    for (let i = 0; i < total; i += this.concurrency) {
      const batch = this.opts.sources.slice(i, i + this.concurrency);
      const batchNum = Math.floor(i / this.concurrency) + 1;
      const totalBatches = Math.ceil(total / this.concurrency);

      const progress = new BatchProgress();
      console.log(`\nBatch ${batchNum}/${totalBatches}`);
      progress.start(batch.map((s) => s.name));

      const batchResults = await Promise.allSettled(
        batch.map((source) => this.processSource(source, progress)),
      );

      progress.finish();

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ source: "unknown", status: "error", error: String(result.reason) });
        }
      }
    }

    return results;
  }

  private async processSource(source: DocSource, progress: BatchProgress): Promise<SourceResult> {
    const ingestor = this.opts.ingestors.find((i) => i.supports(source));
    if (!ingestor) {
      progress.error(source.name, "no ingestor");
      return {
        source: source.name,
        status: "error",
        error: `No ingestor found for source type "${source.type}"`,
      };
    }

    // ─── Freshness check ──────────────────────────────────────────
    try {
      if (this.maxAge > 0) {
        const stamp = await this.readStamp(source.name);
        if (stamp) {
          const ageMs = Date.now() - new Date(stamp.fetchedAt).getTime();
          if (ageMs < this.maxAge * 1000) {
            progress.update(source.name, "checking freshness…");
            const fresh = await this.checkRemoteFreshness(source, stamp);
            if (fresh) {
              const mins = Math.round(ageMs / 60_000);
              progress.done(source.name, `cached (${mins}min ago)`);
              return { source: source.name, status: "skipped" };
            }
          }
        }
      }
    } catch {
      // Freshness check failed — proceed with full fetch
    }

    // ─── Fetch, normalise, write ──────────────────────────────────
    try {
      progress.update(source.name, "fetching…");
      const raw = await ingestor.ingest(source, this.opts.workDir);

      progress.update(source.name, `normalising ${raw.size} files…`);
      const normalised = await this.normalise(raw);

      progress.update(source.name, "writing…");
      const diff = await this.write(normalised);

      const stampData = await this.captureFreshness(source, normalised.version);
      await this.writeStamp(source.name, stampData);

      const summary = `+${diff.added} ~${diff.modified} -${diff.removed} =${diff.unchanged}`;
      progress.done(source.name, summary);

      return { source: source.name, status: "ok", diff, version: normalised.version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress.error(source.name, message.slice(0, 50));
      return { source: source.name, status: "error", error: message };
    }
  }

  // ─── Remote freshness detection ─────────────────────────────────

  /**
   * Check if a source's remote content has changed since last fetch.
   * Returns true if content is unchanged (fresh), false if stale or unknown.
   */
  private async checkRemoteFreshness(source: DocSource, stamp: StampData): Promise<boolean> {
    try {
      if (source.type === "git") {
        return await this.checkGitFreshness(source, stamp);
      }
      return await this.checkHttpFreshness(source, stamp);
    } catch {
      // Can't check → assume stale, re-fetch to be safe
      return false;
    }
  }

  /** git ls-remote HEAD — compare SHA without cloning. */
  private async checkGitFreshness(source: DocSource, stamp: StampData): Promise<boolean> {
    if (!stamp.gitSha) return false;
    const { stdout } = await execFileAsync("git", ["ls-remote", source.url, "HEAD"], {
      timeout: 15_000,
    });
    // Output: "<full-40-char-sha>\tHEAD"
    const remoteSha = stdout.trim().split(/\s/)[0];
    if (!remoteSha) return false;
    // Full-SHA equality. Legacy stamps stored a truncated --short SHA
    // (7-10 chars); tolerate those via prefix match so the cache doesn't
    // invalidate on upgrade. New stamps store full 40-char SHAs.
    if (remoteSha === stamp.gitSha) return true;
    if (stamp.gitSha.length < 40 && remoteSha.startsWith(stamp.gitSha)) return true;
    console.log(`[${source.name}] remote SHA changed: ${stamp.gitSha} → ${remoteSha}`);
    return false;
  }

  /** HEAD request on discoveryUrl — compare ETag / Last-Modified. Retries once on network error. */
  private async checkHttpFreshness(source: DocSource, stamp: StampData): Promise<boolean> {
    const checkUrl = source.discoveryUrl ?? source.url;
    const res = await fetchHead(checkUrl);
    if (!res.ok) return false;

    // ETag is the strongest signal
    const etag = res.headers.get("etag");
    if (etag && stamp.etag) {
      if (etag === stamp.etag) return true;
      console.log(`[${source.name}] ETag changed`);
      return false;
    }

    // Last-Modified is next best
    const lastMod = res.headers.get("last-modified");
    if (lastMod && stamp.lastModified) {
      if (lastMod === stamp.lastModified) return true;
      console.log(`[${source.name}] Last-Modified changed`);
      return false;
    }

    // No comparable headers → can't determine, assume stale
    return false;
  }

  /** After a successful fetch, capture freshness metadata for next comparison. */
  private async captureFreshness(source: DocSource, gitVersion?: string): Promise<StampData> {
    const stamp: StampData = { fetchedAt: new Date().toISOString() };

    if (source.type === "git") {
      stamp.gitSha = gitVersion;
      return stamp;
    }

    // HTTP: HEAD the discovery URL to get ETag/Last-Modified
    try {
      const checkUrl = source.discoveryUrl ?? source.url;
      const res = await fetchHead(checkUrl);
      if (res.ok) {
        const etag = res.headers.get("etag");
        if (etag) stamp.etag = etag;
        const lastMod = res.headers.get("last-modified");
        if (lastMod) stamp.lastModified = lastMod;
      }
    } catch {
      // Non-fatal — stamp without HTTP headers still provides timestamp-based caching
    }

    return stamp;
  }

  // ─── Stamp file I/O ─────────────────────────────────────────────

  private stampPath(sourceName: string): string {
    return path.join(this.opts.outDir, sourceName, ".stamp.json");
  }

  private async readStamp(sourceName: string): Promise<StampData | null> {
    try {
      const raw = await fs.readFile(this.stampPath(sourceName), "utf-8");
      return JSON.parse(raw) as StampData;
    } catch {
      return null;
    }
  }

  private async writeStamp(sourceName: string, data: StampData): Promise<void> {
    const p = this.stampPath(sourceName);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(data), "utf-8");
  }

  // ─── Normalisation pipeline (unchanged) ─────────────────────────

  private async normalise(set: DocSet): Promise<DocSet> {
    const normalised = new Map<string, DocFile>();

    for (const [, file] of set.files) {
      let current = file;

      // Pass 1: format-based normalisation (HTML→md, MDX→md)
      const formatNormaliser = this.opts.normalisers.find((n) =>
        n.supportsFormat(set.source.format),
      );
      if (formatNormaliser) {
        current = await formatNormaliser.normalise(current);
      }

      // Pass 2: extension-based normalisation (catches files not handled by format)
      if (!formatNormaliser) {
        const extNormaliser = this.opts.normalisers.find((n) => n.supports(current));
        if (extNormaliser) {
          current = await extNormaliser.normalise(current);
        }
      }

      // Pass 3: cleanup normalisers (MarkdownCleaner etc.) — runs on all .md files
      // Skip format converters (they already ran in pass 1/2) — identified by
      // supportsFormat returning true for any format.
      for (const cleaner of this.opts.normalisers) {
        if (isFormatConverter(cleaner)) continue;
        if (cleaner.supports(current)) {
          current = await cleaner.normalise(current);
        }
      }

      normalised.set(current.path, current);
    }

    return new DocSet(set.source, normalised, set.fetchedAt, set.version);
  }

  // ─── Write to disk (unchanged) ──────────────────────────────────

  private async write(set: DocSet): Promise<UpdateResult> {
    const destDir = path.join(this.opts.outDir, set.id);

    // Load the previous state for diffing
    const previous = await this.loadPrevious(set.source.name, destDir);

    // Write all current files
    for (const [relativePath, file] of set.files) {
      const dest = path.join(destDir, relativePath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.content, "utf-8");
    }

    // Remove files that no longer exist
    if (previous) {
      for (const prevPath of previous.files.keys()) {
        if (!set.files.has(prevPath)) {
          const dest = path.join(destDir, prevPath);
          await fs.rm(dest, { force: true });
        }
      }
    }

    return previous ? set.diff(previous) : { added: set.size, modified: 0, removed: 0, unchanged: 0 };
  }

  private async loadPrevious(name: string, destDir: string): Promise<DocSet | null> {
    try {
      const files = new Map<string, DocFile>();
      await walkDir(destDir, destDir, files);
      const source = this.opts.sources.find((s) => s.name === name)!;
      return new DocSet(source, files);
    } catch {
      return null;
    }
  }
}
