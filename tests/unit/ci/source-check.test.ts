import { describe, it, expect } from "vitest";
import { filterUrls, hostOf, isTransientStatus, isUncounted, pickSamples, samplesStatus } from "../../../src/ci/source-check.js";
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

describe("isTransientStatus", () => {
  it("retries 429 and 5xx, not 4xx or success", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [200, 301, 403, 404, 410]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe("isUncounted", () => {
  it("skips archive 429s and origin 5xx, counts the rest", () => {
    expect(isUncounted(429, "https://web.archive.org/web/1id_/https://x.example/")).toBe(true);
    expect(isUncounted(429, "https://docs.example/")).toBe(false);
    expect(isUncounted(500, "https://ubuntu.com/server/docs/x/")).toBe(true);
    expect(isUncounted(404, "https://docs.example/")).toBe(false);
  });
});

describe("samplesStatus", () => {
  it("is ok when the only misses are uncounted", () => {
    expect(samplesStatus(3, 0, 1)).toBe("ok");
  });
  it("warns on a hard failure", () => {
    expect(samplesStatus(3, 1, 0)).toBe("warn");
    expect(samplesStatus(3, 1, 1)).toBe("warn");
  });
  it("fails when no sample fetched, uncounted misses included", () => {
    expect(samplesStatus(3, 3, 0)).toBe("fail");
    expect(samplesStatus(3, 0, 3)).toBe("fail");
    expect(samplesStatus(3, 2, 1)).toBe("fail");
  });
});
