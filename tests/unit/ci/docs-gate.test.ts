import { describe, it, expect } from "vitest";
import { checkDocsTree } from "../../../src/ci/docs-gate.js";

describe("checkDocsTree", () => {
  const names = ["a", "b", "c-api"];
  const ok = { a: 10, b: 5, "c-api": 3 };

  it("passes a complete tree", () => {
    expect(checkDocsTree({ counts: ok, sourceNames: names, floors: {}, overviews: {}, apiSources: [] })).toEqual([]);
  });

  it("flags a source missing from the tree", () => {
    const { b: _b, ...counts } = ok;
    expect(checkDocsTree({ counts, sourceNames: names, floors: {}, overviews: {}, apiSources: [] })).toEqual([
      "b: missing (no docs/b directory)",
    ]);
  });

  it("flags an empty source", () => {
    expect(
      checkDocsTree({ counts: { ...ok, a: 0 }, sourceNames: names, floors: {}, overviews: {}, apiSources: [] }),
    ).toEqual(["a: 0 files"]);
  });

  it("flags a source below its floor", () => {
    expect(
      checkDocsTree({ counts: ok, sourceNames: names, floors: { a: 100 }, overviews: {}, apiSources: [] }),
    ).toEqual(["a: 10 files, floor is 100"]);
  });

  it("ignores floors for sources no longer defined", () => {
    expect(
      checkDocsTree({ counts: ok, sourceNames: names, floors: { gone: 100 }, overviews: {}, apiSources: [] }),
    ).toEqual([]);
  });

  it("flags an API source without api/overview.md", () => {
    expect(
      checkDocsTree({
        counts: ok,
        sourceNames: names,
        floors: {},
        overviews: { "c-api": false },
        apiSources: ["c-api"],
      }),
    ).toEqual(["c-api: no api/overview.md"]);
  });

  it("tolerates a listed source being missing, but still checks it when present", () => {
    const { a: _a, ...counts } = ok;
    const base = { sourceNames: names, floors: { a: 100 }, overviews: {}, apiSources: [], tolerated: { a: "blocked" } };
    expect(checkDocsTree({ ...base, counts })).toEqual([]);
    expect(checkDocsTree({ ...base, counts: ok })).toEqual(["a: 10 files, floor is 100"]);
  });
});
