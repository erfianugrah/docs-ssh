import type { DocFile } from "./DocFile.js";
import type { DocFormat } from "./DocSource.js";

/**
 * Port for transforming a raw DocFile into clean markdown.
 * Implementations handle MDX stripping, HTML conversion, etc.
 */
export interface DocNormaliser {
  readonly name: string;
  /** Returns true if this normaliser can handle the given file (extension-based) */
  supports(file: DocFile): boolean;
  /**
   * Returns true if this normaliser should be used for an entire source
   * declared with the given format. Only format-converting normalisers
   * (e.g. HTML→MD, MDX→MD) implement this; cleanup normalisers return false.
   */
  supportsFormat(format: DocFormat): boolean;
  /**
   * Returns a new DocFile with normalised content, or `null` to drop the
   * file from the doc set entirely. Dropping is for pages with no doc
   * value whose conversion would otherwise leak unusable content into
   * the corpus (e.g. an SPA app-shell HTML page that Turndown reduces
   * to near-nothing - keeping it as raw .html breaks the invariant that
   * markdown-capable sources contain only .md files).
   */
  normalise(file: DocFile): Promise<DocFile | null>;
}
