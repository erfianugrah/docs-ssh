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

  // ─── Edge cases ───────────────────────────────────────────────────

  it("extension returns last segment for files with multiple dots", () => {
    expect(new DocFile("file.test.ts", "").extension).toBe("ts");
    expect(new DocFile("archive.tar.gz", "").extension).toBe("gz");
  });

  it("extension returns filename itself for files with no dot", () => {
    // This is a known quirk: split(".").pop() returns the whole name
    expect(new DocFile("Makefile", "").extension).toBe("Makefile");
  });

  it("equals returns false when paths differ but content matches", () => {
    const a = new DocFile("a.md", "same");
    const b = new DocFile("b.md", "same");
    expect(a.equals(b)).toBe(false);
  });

  it("withPath throws if new path is empty", () => {
    const file = new DocFile("x.md", "content");
    expect(() => file.withPath("")).toThrow("path must not be empty");
  });

  it("withPath throws if new path is absolute", () => {
    const file = new DocFile("x.md", "content");
    expect(() => file.withPath("/etc/passwd")).toThrow("must be relative");
  });

  it("throws if path is whitespace-only", () => {
    expect(() => new DocFile("   ", "content")).toThrow("path must not be empty");
  });

  it("allows empty content", () => {
    const f = new DocFile("empty.md", "");
    expect(f.content).toBe("");
    expect(f.isEmpty).toBe(true);
  });
});
