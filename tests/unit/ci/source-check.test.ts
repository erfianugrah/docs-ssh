import { describe, it, expect, vi, afterEach } from "vitest";
import { checkSource, checkUpstream, filterUrls, hostOf, isForeignBlock, isTransientStatus, isPinnedCapture, isUncounted, pickSamples, probeTimeoutMs, samplesStatus } from "../../../src/ci/source-check.js";
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

describe("isForeignBlock", () => {
  // planet-postgres: postgr.es/p/9Br redirects to a cybertec blog whose
  // Cloudflare 403s Node fetch whatever the UA (check-sources 237/241/245).
  const req = "https://postgr.es/p/9Br";
  const blog = "https://www.cybertec-postgresql.com/en/slonik/";
  it("skips a 4xx served by another host on a redirecting aggregator", () => {
    expect(isForeignBlock(true, req, blog, 403)).toBe(true);
  });
  it("counts it when the source does not expect redirects", () => {
    expect(isForeignBlock(false, req, blog, 403)).toBe(false);
  });
  it("counts a 4xx from the source's own host", () => {
    expect(isForeignBlock(true, req, "https://postgr.es/p/9Bs", 404)).toBe(false);
  });
  it("ignores successes", () => {
    expect(isForeignBlock(true, req, blog, 200)).toBe(false);
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

describe("probeTimeoutMs", () => {
  const base = { name: "x", type: "http" as const, format: "html" as const, url: "https://wiki.example.com/" };

  it("uses the CLI default for a source with no deadline", () => {
    expect(probeTimeoutMs(new DocSource(base), 300_000)).toBe(300_000);
  });

  it("extends to the source's build deadline when that is longer (slow wikis)", () => {
    expect(probeTimeoutMs(new DocSource({ ...base, deadlineMs: 1_800_000 }), 300_000)).toBe(1_800_000);
  });

  it("never shortens the CLI default", () => {
    expect(probeTimeoutMs(new DocSource({ ...base, deadlineMs: 60_000 }), 300_000)).toBe(300_000);
  });
});

describe("checkSource bulk redirects", () => {
  const tarball = (expectRedirects: boolean) =>
    new DocSource({
      name: "pkg",
      type: "http",
      format: "html",
      url: "https://wiki.example.com/title/",
      discovery: "tarball",
      discoveryUrl: "https://pkgs.example.com/pkg/download/",
      expectRedirects,
    });

  function stubRedirectedArchive() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const res = new Response("zstd-bytes", { status: 200, headers: { "content-type": "application/zstd" } });
        Object.defineProperty(res, "url", { value: "https://mirror.example.net/pkg.tar.zst" });
        return res;
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("warns when a bulk download redirects to another host", async () => {
    stubRedirectedArchive();
    const r = await checkSource(tarball(false));
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("redirects to mirror.example.net");
  });

  it("is ok when the source expects redirects (mirror download URLs)", async () => {
    stubRedirectedArchive();
    const r = await checkSource(tarball(true));
    expect(r.status).toBe("ok");
  });
});

describe("isPinnedCapture", () => {
  it("matches only timestamp-pinned Wayback raw captures", () => {
    expect(isPinnedCapture("https://web.archive.org/web/20240701194425id_/https://docs.redhat.com/x")).toBe(true);
    expect(isPinnedCapture("https://web.archive.org/web/2/https://docs.redhat.com/x")).toBe(false);
    expect(isPinnedCapture("https://docs.redhat.com/x")).toBe(false);
  });
});

describe("checkSource archived pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not fetch a source made entirely of pinned captures", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const source = new DocSource({
      name: "pinned",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: [
        "https://web.archive.org/web/20240701194425id_/https://example.com/a",
        "https://web.archive.org/web/20240701194426id_/https://example.com/b",
      ],
    });

    const r = await checkSource(source);
    expect(r.status).toBe("ok");
    expect(r.count).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("samples live origin pages instead of archived pages in a mixed source", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const source = new DocSource({
      name: "mixed",
      type: "http",
      format: "html",
      url: "https://example.com/",
      urls: [
        "https://web.archive.org/web/20240701194425id_/https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://web.archive.org/web/20240701194426id_/https://example.com/d",
      ],
    });

    const r = await checkSource(source);
    expect(r.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("https://example.com/"))).toBe(true);
  });
});

describe("checkUpstream", () => {
  afterEach(() => vi.unstubAllGlobals());
  const base = { since: "2026-11-01", checked: "2026-11-22", evidence: "e", fallback: "f" };

  it("warns when a blocked host answers 200 (block lifted)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const r = await checkUpstream("b.example", { ...base, status: "blocked", probe: "https://b.example/x" });
    expect(r.name).toBe("upstream:b.example");
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/block lifted/);
  });

  it("confirms the block on 403, a 202 challenge page and a network error", async () => {
    for (const impl of [
      async () => new Response("no", { status: 403 }),
      async () => new Response("challenge", { status: 202 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      vi.stubGlobal("fetch", vi.fn(impl));
      const r = await checkUpstream("b.example", { ...base, status: "challenge", probe: "https://b.example/x" });
      expect(r.status).toBe("ok");
      expect(r.detail).toMatch(/^still challenge/);
    }
  });

  it("sends the markdown Accept header only for header-filtered hosts", async () => {
    const fetchMock = vi.fn(async (_u: string, _init?: RequestInit) => new Response("no", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await checkUpstream("h.example", { ...base, status: "header-filtered", probe: "https://h.example/" });
    await checkUpstream("u.example", { ...base, status: "ua-filtered", probe: "https://u.example/" });
    const h0 = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const h1 = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(h0.Accept).toMatch(/text\/markdown/);
    expect(h1.Accept).toBeUndefined();
  });
});
