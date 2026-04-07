import { describe, it, expect } from "vitest";
import { DocFile } from "../../../src/domain/DocFile.js";

describe("DocFile", () => {
  it("constructs with valid path and content", () => {
    const f = new DocFile("guides/auth.md", "# Auth\nsome content");
    expect(f.path).toBe("guides/auth.md");
    expect(f.content).toBe("# Auth\nsome content");
  });

  it("throws if path is empty", () => {
    expect(() => new DocFile("", "content")).toThrow("path must not be empty");
  });

  it("throws if path is absolute", () => {
    expect(() => new DocFile("/guides/auth.md", "content")).toThrow("must be relative");
  });

  it("isEmpty returns true for blank content", () => {
    expect(new DocFile("x.md", "   \n  ").isEmpty).toBe(true);
    expect(new DocFile("x.md", "hello").isEmpty).toBe(false);
  });

  it("extension extracts file extension", () => {
    expect(new DocFile("foo/bar.md", "").extension).toBe("md");
    expect(new DocFile("foo/bar.mdx", "").extension).toBe("mdx");
    expect(new DocFile("foo/bar.html", "").extension).toBe("html");
  });

  it("withContent returns new DocFile with updated content", () => {
    const original = new DocFile("x.md", "old");
    const updated = original.withContent("new");
    expect(updated.content).toBe("new");
    expect(updated.path).toBe("x.md");
    expect(original.content).toBe("old"); // immutable
  });

  it("withPath returns new DocFile with updated path", () => {
    const original = new DocFile("x.md", "content");
    const updated = original.withPath("y.md");
    expect(updated.path).toBe("y.md");
    expect(original.path).toBe("x.md"); // immutable
  });

  it("equals compares path and content", () => {
    const a = new DocFile("x.md", "hello");
    const b = new DocFile("x.md", "hello");
    const c = new DocFile("x.md", "world");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
