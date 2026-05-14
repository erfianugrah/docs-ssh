import type { DocFile } from "./DocFile.js";
import type { DocSource } from "./DocSource.js";

export interface UpdateResult {
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly unchanged: number;
}

/**
 * Per-source content-negotiation telemetry. Captured by HttpIngestor
 * during page-by-page fetches; persisted in the stamp file so that
 * adoption-rate drift can be detected across builds (e.g. an upstream
 * disabling its markdown converter would show as a sudden drop in
 * `markdown` count).
 */
export interface NegotiationStats {
  /** Pages where origin returned text/markdown directly. */
  readonly markdown: number;
  /** Pages where origin returned HTML (the spec-compliant fallback). */
  readonly html: number;
  /** Pages recovered via Accept: text/html retry after a 404/406. */
  readonly fallback404: number;
  /** Pages where markdown body was suspiciously thin → HTML used. */
  readonly fallbackThin: number;
  /** Pages where Content-Type lied → body was actually HTML. */
  readonly fallbackLyingCt: number;
  /** Sum of `x-markdown-tokens` across all markdown responses. */
  readonly totalTokens: number;
}

/**
 * Entity representing a fetched, normalised collection of docs from one source.
 * Identity is the source name.
 */
export class DocSet {
  readonly source: DocSource;
  readonly files: ReadonlyMap<string, DocFile>;
  readonly fetchedAt: Date;
  /** Git SHA or other version identifier, if available */
  readonly version: string | undefined;
  /** Content-negotiation outcomes — set by HttpIngestor only. */
  readonly negotiation: NegotiationStats | undefined;

  constructor(
    source: DocSource,
    files: ReadonlyMap<string, DocFile>,
    fetchedAt: Date = new Date(),
    version?: string,
    negotiation?: NegotiationStats,
  ) {
    this.source = source;
    this.files = files;
    this.fetchedAt = fetchedAt;
    this.version = version;
    this.negotiation = negotiation;
  }

  get size(): number {
    return this.files.size;
  }

  get id(): string {
    return this.source.name;
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  getFile(path: string): DocFile | undefined {
    return this.files.get(path);
  }

  /**
   * Compute a diff summary comparing this DocSet against a previous one.
   */
  diff(previous: DocSet): UpdateResult {
    const prevPaths = new Set(previous.files.keys());
    const currPaths = new Set(this.files.keys());

    let added = 0;
    let modified = 0;
    let unchanged = 0;

    for (const path of currPaths) {
      if (!prevPaths.has(path)) {
        added++;
      } else {
        const prev = previous.files.get(path)!;
        const curr = this.files.get(path)!;
        if (prev.content === curr.content) {
          unchanged++;
        } else {
          modified++;
        }
      }
    }

    const removed = [...prevPaths].filter((p) => !currPaths.has(p)).length;
    return { added, modified, removed, unchanged };
  }
}
