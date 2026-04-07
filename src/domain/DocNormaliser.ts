import type { DocFile } from "./DocFile.js";

/**
 * Port for transforming a raw DocFile into clean markdown.
 * Implementations handle MDX stripping, HTML conversion, etc.
 */
export interface DocNormaliser {
  readonly name: string;
  /** Returns true if this normaliser can handle the given file */
  supports(file: DocFile): boolean;
  /** Returns a new DocFile with normalised content */
  normalise(file: DocFile): Promise<DocFile>;
}
