import { describe, it, expect } from "vitest";
import { extractLinks } from "../../../../src/ingestors/discovery/toc.js";

describe("toc extractLinks", () => {
  it("accepts double- and single-quoted hrefs (pydata-sphinx-theme uses single quotes)", () => {
    const html = `<a href="/a.html">a</a><a href='/api/b.html#x'>b</a><a href='/s.css'>c</a>`;
    expect(extractLinks(html, "https://docs.example.org/")).toEqual([
      "https://docs.example.org/a.html",
      "https://docs.example.org/api/b.html",
    ]);
  });
});
