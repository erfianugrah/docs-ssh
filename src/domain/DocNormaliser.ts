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
  /** Returns a new DocFile with normalised content */
  normalise(file: DocFile): Promise<DocFile>;
}
