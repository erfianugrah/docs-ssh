/**
 * Value object representing a single documentation file.
 * Path is relative to the DocSet root (e.g. "guides/auth/passwords.md").
 *
 * `preNormalised` signals that the content is already in the target
 * format (markdown) and should bypass format-converter normalisers
 * like HtmlNormaliser. Set by HttpIngestor when an upstream returns
 * `Content-Type: text/markdown` in response to a content-negotiated
 * fetch (per the acceptmarkdown.com spec / Cloudflare Markdown for
 * Agents). Cleanup normalisers (MarkdownCleaner, ContentSanitiser)
 * still run on pre-normalised content.
 */
export interface DocFileOptions {
  /** Content is already in the target format — skip format conversion. */
  preNormalised?: boolean;
  /** Public URL this file was fetched from / can be read at. */
  originUrl?: string;
}

export class DocFile {
  readonly path: string;
  readonly content: string;
  readonly preNormalised: boolean;
  /**
   * Public URL the content came from (upstream page or repo browse URL).
   * Carried through every path/content rewrite so the published file can
   * still be cited after normalisation changed its extension.
   */
  readonly originUrl: string | undefined;

  constructor(path: string, content: string, opts: DocFileOptions = {}) {
    if (!path || path.trim() === "") {
      throw new Error("DocFile: path must not be empty");
    }
    if (path.startsWith("/")) {
      throw new Error("DocFile: path must be relative, not absolute");
    }
    this.path = path;
    this.content = content;
    this.preNormalised = opts.preNormalised ?? false;
    this.originUrl = opts.originUrl;
  }

  get isEmpty(): boolean {
    return this.content.trim() === "";
  }

  get extension(): string {
    return this.path.split(".").pop() ?? "";
  }

  withContent(content: string): DocFile {
    return new DocFile(this.path, content, {
      preNormalised: this.preNormalised,
      originUrl: this.originUrl,
    });
  }

  withPath(path: string): DocFile {
    return new DocFile(path, this.content, {
      preNormalised: this.preNormalised,
      originUrl: this.originUrl,
    });
  }

  equals(other: DocFile): boolean {
    return this.path === other.path && this.content === other.content;
  }
}
