import { describe, expect, it } from "vitest";
import { DocSource } from "../../../src/domain/DocSource.js";
import { SOURCES } from "../../../src/application/sources.js";
import { UPSTREAM_ACCESS, accessViolations, directFetchUrls } from "../../../src/application/upstream-access.js";

type Cfg = ConstructorParameters<typeof DocSource>[0];

const entry = (status: "blocked" | "ua-filtered" | "header-filtered") => ({
  status,
  since: "2026-11-01",
  checked: "2026-11-22",
  evidence: "test",
  fallback: "test",
});

const http = (cfg: Partial<Cfg>) =>
  new DocSource({ name: "x", type: "http", url: "https://example.org/", format: "html", ...cfg } as Cfg);

describe("upstream access registry", () => {
  it("every source respects its host's entry", () => {
    expect(accessViolations(SOURCES)).toEqual([]);
  });

  it("entries are well formed", () => {
    for (const [host, e] of Object.entries(UPSTREAM_ACCESS)) {
      expect(host, host).toMatch(/^[a-z0-9.-]+$/);
      expect(e.since, host).toMatch(/^\d{4}-\d{2}(-\d{2})?$/);
      expect(e.checked, host).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.checked >= e.since, `${host}: checked before since`).toBe(true);
      if (e.probe) expect(new URL(e.probe).host, `${host}: probe on another host`).toBe(host);
      if (e.status === "lifted") expect(e.probe, `${host}: lifted entries are not re-probed`).toBeUndefined();
    }
  });

  it("flags a live fetch from a blocked host, accepts captures and an off-host fallback", () => {
    const reg = { "blocked.example": entry("blocked") };
    const live = http({ name: "live", discovery: "pdf", discoveryUrl: "https://blocked.example/a.pdf" });
    const pinned = http({ name: "pinned", urls: ["https://web.archive.org/web/20250101000000id_/https://blocked.example/a"] });
    const fb = http({
      name: "fb",
      discovery: "texinfo",
      discoveryUrl: "https://blocked.example/a.zip",
      fallbackDiscoveryUrl: "https://web.archive.org/web/20250101000000if_/https://blocked.example/a.zip",
    });
    expect(accessViolations([live, pinned, fb], reg)).toEqual([
      expect.stringMatching(/^live: fetches https:\/\/blocked\.example\/a\.pdf live/),
    ]);
  });

  it("requires userAgent on ua-filtered and skipMarkdownNegotiation on header-filtered hosts", () => {
    const reg = { "ua.example": entry("ua-filtered"), "hdr.example": entry("header-filtered") };
    const ua = http({ name: "ua", url: "https://ua.example/" });
    const uaOk = http({ name: "uaok", url: "https://ua.example/", userAgent: "Mozilla/5.0" });
    const hdr = http({ name: "hdr", url: "https://hdr.example/" });
    const hdrOk = http({ name: "hdrok", url: "https://hdr.example/", skipMarkdownNegotiation: true });
    expect(accessViolations([ua, uaOk, hdr, hdrOk], reg)).toEqual([
      expect.stringMatching(/^ua: /),
      expect.stringMatching(/^hdr: /),
    ]);
  });

  it("directFetchUrls: pdf list, page list, bare url", () => {
    expect(directFetchUrls(http({ discovery: "pdf", discoveryUrl: "https://a/1.pdf  https://a/2.pdf" }))).toEqual([
      "https://a/1.pdf",
      "https://a/2.pdf",
    ]);
    expect(directFetchUrls(http({ urls: ["https://a/p"] }))).toEqual(["https://a/p"]);
    expect(directFetchUrls(http({}))).toEqual(["https://example.org/"]);
  });
});
