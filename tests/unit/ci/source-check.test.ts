import { describe, it, expect } from "vitest";
import { filterUrls, hostOf, pickSamples } from "../../../src/ci/source-check.js";
import { DocSource } from "../../../src/domain/DocSource.js";

describe("filterUrls", () => {
  const urls = [
    "https://blog.cloudflare.com/a-post/",
    "https://blog.cloudflare.com/de-de/a-post/",
    "https://blog.cloudflare.com/zh-cn/a-post/",
    "https://blog.cloudflare.com/a-post/",
  ];

  it("applies urlExclude and dedupes like HttpIngestor", () => {
    const src = new DocSource({
      name: "cloudflare-blog",
      type: "http",
      format: "html",
      url: "https://blog.cloudflare.com/",
      urlExclude: "blog\\.cloudflare\\.com/[a-z]{2}-[a-z]{2}/[^/]+",
    });
    expect(filterUrls(src, urls)).toEqual(["https://blog.cloudflare.com/a-post/"]);
  });

  it("returns nothing when urlPattern matches no URL (moved docs)", () => {
    const src = new DocSource({
      name: "x",
      type: "http",
      format: "html",
      url: "https://fly.io/docs/",
      urlPattern: "fly\\.io/docs/.+",
    });
    expect(filterUrls(src, ["https://fly.io/pricing", "https://fly.io/"])).toEqual([]);
  });

  // silo's toc already links /docs/index.md; appending again gave index.md/index.md.
  it("does not append urlSuffix twice", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://e.com/", urlSuffix: "/index.md" });
    expect(filterUrls(src, ["https://e.com/docs/index.md", "https://e.com/docs/a/"])).toEqual([
      "https://e.com/docs/index.md",
      "https://e.com/docs/a/index.md",
    ]);
  });

  it("appends urlSuffix", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://e.com/", urlSuffix: ".md" });
    expect(filterUrls(src, ["https://e.com/a/"])).toEqual(["https://e.com/a.md"]);
  });
});

describe("pickSamples", () => {
  it("returns all items when there are few", () => {
    expect(pickSamples([1, 2], 3)).toEqual([1, 2]);
  });

  it("spreads picks across the list", () => {
    expect(pickSamples([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 3, 6]);
  });
});

describe("hostOf", () => {
  it("returns the host or empty", () => {
    expect(hostOf("https://docs.fly.io/x")).toBe("docs.fly.io");
    expect(hostOf("not a url")).toBe("");
  });
});
