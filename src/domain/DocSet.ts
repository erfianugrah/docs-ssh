import type { DocFile } from "./DocFile.js";
import type { DocSource } from "./DocSource.js";

export interface UpdateResult {
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly unchanged: number;
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

  constructor(
    source: DocSource,
    files: ReadonlyMap<string, DocFile>,
    fetchedAt: Date = new Date(),
    version?: string,
  ) {
    this.source = source;
    this.files = files;
    this.fetchedAt = fetchedAt;
    this.version = version;
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
