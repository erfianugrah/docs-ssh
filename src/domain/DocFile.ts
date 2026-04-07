/**
 * Value object representing a single documentation file.
 * Path is relative to the DocSet root (e.g. "guides/auth/passwords.md").
 */
export class DocFile {
  readonly path: string;
  readonly content: string;

  constructor(path: string, content: string) {
    if (!path || path.trim() === "") {
      throw new Error("DocFile: path must not be empty");
    }
    if (path.startsWith("/")) {
      throw new Error("DocFile: path must be relative, not absolute");
    }
    this.path = path;
    this.content = content;
  }

  get isEmpty(): boolean {
    return this.content.trim() === "";
  }

  get extension(): string {
    return this.path.split(".").pop() ?? "";
  }

  withContent(content: string): DocFile {
    return new DocFile(this.path, content);
  }

  withPath(path: string): DocFile {
    return new DocFile(path, this.content);
  }

  equals(other: DocFile): boolean {
    return this.path === other.path && this.content === other.content;
  }
}
