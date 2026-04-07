import type { DocSet } from "./DocSet.js";
import type { DocSource } from "./DocSource.js";

/**
 * Port (interface) that all ingestors must implement.
 * Each ingestor is responsible for fetching docs from one type of source
 * and returning a normalised DocSet.
 */
export interface DocIngestor {
  /** Human-readable name, e.g. "GitIngestor" */
  readonly name: string;

  /** Returns true if this ingestor can handle the given source */
  supports(source: DocSource): boolean;

  /** Fetch and return a DocSet. May throw on network/parse failure. */
  ingest(source: DocSource, workDir: string): Promise<DocSet>;
}
