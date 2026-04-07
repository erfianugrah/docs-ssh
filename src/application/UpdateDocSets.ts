import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DocFile } from "../domain/DocFile.js";
import { DocSet, type UpdateResult } from "../domain/DocSet.js";
import type { DocIngestor } from "../domain/DocIngestor.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocSource } from "../domain/DocSource.js";

export interface UpdateDocSetsOptions {
  sources: readonly DocSource[];
  ingestors: readonly DocIngestor[];
  normalisers: readonly DocNormaliser[];
  outDir: string;
  workDir: string;
}

export interface SourceResult {
  source: string;
  status: "ok" | "error";
  diff?: UpdateResult;
  version?: string;
  error?: string;
}

/**
 * Application service: orchestrates fetching, normalising and writing all DocSets.
 */
export class UpdateDocSets {
  constructor(private readonly opts: UpdateDocSetsOptions) {}

  async run(): Promise<SourceResult[]> {
    const results: SourceResult[] = [];

    for (const source of this.opts.sources) {
      const ingestor = this.opts.ingestors.find((i) => i.supports(source));
      if (!ingestor) {
        results.push({
          source: source.name,
          status: "error",
          error: `No ingestor found for source type "${source.type}"`,
        });
        continue;
      }

      try {
        console.log(`[${source.name}] fetching…`);
        const raw = await ingestor.ingest(source, this.opts.workDir);
        const normalised = await this.normalise(raw);
        const diff = await this.write(normalised);

        results.push({
          source: source.name,
          status: "ok",
          diff,
          version: normalised.version,
        });

        console.log(
          `[${source.name}] done — +${diff.added} ~${diff.modified} -${diff.removed} =${diff.unchanged}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${source.name}] error: ${message}`);
        results.push({ source: source.name, status: "error", error: message });
      }
    }

    return results;
  }

  private async normalise(set: DocSet): Promise<DocSet> {
    const normalised = new Map<string, DocFile>();

    for (const [, file] of set.files) {
      let current = file;

      // Pass 1: format-based normalisation (HTML→md, MDX→md)
      const formatNormaliser = this.opts.normalisers.find((n) => {
        if (set.source.format === "html" && n.name === "HtmlNormaliser") return true;
        if (set.source.format === "mdx" && n.name === "MdxNormaliser") return true;
        return false;
      });
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
      for (const cleaner of this.opts.normalisers) {
        if (cleaner.name !== "HtmlNormaliser" && cleaner.name !== "MdxNormaliser" && cleaner.supports(current)) {
          current = await cleaner.normalise(current);
        }
      }

      normalised.set(current.path, current);
    }

    return new DocSet(set.source, normalised, set.fetchedAt, set.version);
  }

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

async function walkDir(dir: string, root: string, files: Map<string, DocFile>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, root, files);
    } else if (entry.isFile()) {
      const rel = path.relative(root, full);
      const content = await fs.readFile(full, "utf-8");
      files.set(rel, new DocFile(rel, content));
    }
  }
}
