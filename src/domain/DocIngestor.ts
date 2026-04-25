import type { DocSet } from "./DocSet.js";
import type { DocSource } from "./DocSource.js";

/**
 * Port (interface) that all ingestors must implement.
 * Each ingestor is responsible for fetching docs from one type of source
 * and returning a normalised DocSet.
 *
 * The optional AbortSignal lets the caller cancel in-flight work (e.g.
 * UpdateDocSets.withDeadline aborts any source that exceeds its
 * deadline, releasing fetch handles and timer resources promptly
 * instead of leaking them until process exit).
 */
export interface DocIngestor {
  /** Human-readable name, e.g. "GitIngestor" */
  readonly name: string;

  /** Returns true if this ingestor can handle the given source */
  supports(source: DocSource): boolean;

  /** Fetch and return a DocSet. May throw on network/parse failure. */
  ingest(source: DocSource, workDir: string, signal?: AbortSignal): Promise<DocSet>;
}
