import type { DocFile } from "../domain/DocFile.js";
import type { DocNormaliser } from "../domain/DocNormaliser.js";
import type { DocFormat } from "../domain/DocSource.js";

/**
 * Security sanitiser that runs on all files before writing to disk.
 *
 * Strips:
 * - ANSI escape sequences (prevents terminal injection via cat/grep output)
 * - Null bytes (prevents C-string truncation attacks)
 * - Control characters except \n \r \t (preserves formatting)
 *
 * Also validates file paths against traversal attacks.
 */
export class ContentSanitiser implements DocNormaliser {
  readonly name = "ContentSanitiser";

  supports(_file: DocFile): boolean {
    // Run on every file
    return true;
  }

  supportsFormat(_format: DocFormat): boolean {
    return false;
  }

  async normalise(file: DocFile): Promise<DocFile> {
    let content = file.content;

    // Strip ANSI escape sequences (CSI, OSC, etc.)
    // These could manipulate the agent's terminal when output via cat/grep
    content = content.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[^[\]].?/g,
      "",
    );

    // Strip null bytes
    content = content.replace(/\0/g, "");

    // Strip other control characters except newline, carriage return, tab
    // eslint-disable-next-line no-control-regex
    content = content.replace(/[\x01-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, "");

    // Validate the file path is safe
    const safePath = sanitisePath(file.path);

    return file.withContent(content).withPath(safePath);
  }
}

/**
 * Sanitises a file path to prevent directory traversal.
 * - Strips leading slashes (absolute paths)
 * - Removes .. components
 * - Collapses repeated slashes
 * - Strips control characters from path
 */
function sanitisePath(p: string): string {
  return p
    .replace(/\.\.\//g, "")     // strip ../
    .replace(/\.\.\\/g, "")     // strip ..\
    .replace(/^\/+/, "")        // strip leading /
    .replace(/\/\/+/g, "/")     // collapse //
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ""); // strip control chars from path
}
