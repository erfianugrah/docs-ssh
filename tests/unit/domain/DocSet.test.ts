import { describe, it, expect } from "vitest";
import { DocFile } from "../../../src/domain/DocFile.js";
import { DocSet } from "../../../src/domain/DocSet.js";
import { DocSource } from "../../../src/domain/DocSource.js";

const makeSource = (name = "test") =>
  new DocSource({ name, type: "git", format: "markdown", url: "https://github.com/x/y" });

const makeFiles = (entries: [string, string][]): ReadonlyMap<string, DocFile> =>
  new Map(entries.map(([path, content]) => [path, new DocFile(path, content)]));

describe("DocSet", () => {
  it("constructs and exposes basic properties", () => {
    const source = makeSource();
    const files = makeFiles([["guides/auth.md", "# Auth"]]);
    const set = new DocSet(source, files);
    expect(set.id).toBe("test");
    expect(set.size).toBe(1);
    expect(set.source).toBe(source);
  });

  it("hasFile returns correct boolean", () => {
    const set = new DocSet(makeSource(), makeFiles([["a.md", "content"]]));
    expect(set.hasFile("a.md")).toBe(true);
    expect(set.hasFile("b.md")).toBe(false);
  });

  it("getFile returns the file or undefined", () => {
    const set = new DocSet(makeSource(), makeFiles([["a.md", "content"]]));
    expect(set.getFile("a.md")?.path).toBe("a.md");
    expect(set.getFile("missing.md")).toBeUndefined();
  });

  describe("diff", () => {
    it("detects added files", () => {
      const prev = new DocSet(makeSource(), makeFiles([]));
      const curr = new DocSet(makeSource(), makeFiles([["new.md", "content"]]));
      const result = curr.diff(prev);
      expect(result.added).toBe(1);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);
    });

    it("detects modified files", () => {
      const prev = new DocSet(makeSource(), makeFiles([["a.md", "old"]]));
      const curr = new DocSet(makeSource(), makeFiles([["a.md", "new"]]));
      const result = curr.diff(prev);
      expect(result.modified).toBe(1);
      expect(result.added).toBe(0);
    });

    it("detects removed files", () => {
      const prev = new DocSet(makeSource(), makeFiles([["a.md", "content"]]));
      const curr = new DocSet(makeSource(), makeFiles([]));
      const result = curr.diff(prev);
      expect(result.removed).toBe(1);
    });

    it("counts unchanged files", () => {
      const files = makeFiles([["a.md", "same"]]);
      const prev = new DocSet(makeSource(), files);
      const curr = new DocSet(makeSource(), files);
      const result = curr.diff(prev);
      expect(result.unchanged).toBe(1);
      expect(result.added).toBe(0);
      expect(result.modified).toBe(0);
      expect(result.removed).toBe(0);
    });

    it("handles mixed changes", () => {
      const prev = new DocSet(
        makeSource(),
        makeFiles([
          ["keep.md", "same"],
          ["modify.md", "old"],
          ["remove.md", "bye"],
        ]),
      );
      const curr = new DocSet(
        makeSource(),
        makeFiles([
          ["keep.md", "same"],
          ["modify.md", "new"],
          ["added.md", "hello"],
        ]),
      );
      const result = curr.diff(prev);
      expect(result.unchanged).toBe(1);
      expect(result.modified).toBe(1);
      expect(result.removed).toBe(1);
      expect(result.added).toBe(1);
    });
  });
});
