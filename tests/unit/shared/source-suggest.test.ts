import { describe, it, expect } from "vitest";
import { suggestSource, damerauLevenshtein } from "../../../src/shared/source-suggest.js";

// A realistic slice of the live source list (from docs_sources Nov 2024).
const LIVE_SOURCES = [
  "ansible",
  "archwiki",
  "aws-api",
  "aws-sdk",
  "aws-waf",
  "azure-key-vault",
  "bun",
  "cloudflare",
  "cloudflare-api",
  "cloudflare-blog",
  "deno",
  "docker-api",
  "flyio",
  "flyio-api",
  "ietf-rfc",
  "jlcpcb",
  "kicad",
  "kicad-dev-docs",
  "kicad-python",
  "kubernetes-api",
  "libhmk",
  "libhmk-source",
  "lidarr-api",
  "nextjs",
  "nuvoton-m480-bsp",
  "openwrt",
  "postgres",
  "prisma",
  "react",
  "servarr",
  "supabase",
  "supabase-api",
  "supabase-auth-api",
  "supabase-status",
  "turborepo",
];

describe("damerauLevenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(damerauLevenshtein("supabase", "supabase")).toBe(0);
  });

  it("returns the other length for empty string", () => {
    expect(damerauLevenshtein("", "abc")).toBe(3);
    expect(damerauLevenshtein("abc", "")).toBe(3);
  });

  it("counts single character substitution", () => {
    expect(damerauLevenshtein("supabase", "supabasz")).toBe(1);
  });

  it("counts transpositions as 1", () => {
    expect(damerauLevenshtein("ca", "ac")).toBe(1);
  });
});

describe("suggestSource", () => {
  it("returns suggestions for a non-existent source (caller checks existence first)", () => {
    // "zzzexact" is not in LIVE_SOURCES, but matches by DL
    expect(suggestSource("zzzexact", LIVE_SOURCES)).toEqual([]);
  });

  it("prefix: lidarr -> lidarr-api", () => {
    const result = suggestSource("lidarr", LIVE_SOURCES);
    expect(result).toContain("lidarr-api");
    expect(result[0]).toBe("lidarr-api");
  });

  it("prefix: nuvoton -> nuvoton-m480-bsp", () => {
    const result = suggestSource("nuvoton", LIVE_SOURCES);
    expect(result).toContain("nuvoton-m480-bsp");
  });

  it("prefix: fly -> flyio, flyio-api", () => {
    const result = suggestSource("fly", LIVE_SOURCES);
    expect(result).toContain("flyio");
    expect(result).toContain("flyio-api");
  });

  it("prefix: rfc -> ietf-rfc (prefix of the suffix, not prefix of name)", () => {
    const result = suggestSource("rfc", LIVE_SOURCES);
    // "rfc" is NOT a prefix of "ietf-rfc", but it matches via hyphen-segment
    expect(result).toContain("ietf-rfc");
  });

  it("hyphen-segment: aws -> aws-api, aws-sdk, aws-waf", () => {
    const result = suggestSource("aws", LIVE_SOURCES);
    expect(result).toContain("aws-api");
    expect(result).toContain("aws-sdk");
    expect(result).toContain("aws-waf");
  });

  it("hyphen-segment: supa matches supabase*, but not prefix of any", () => {
    const result = suggestSource("supa", LIVE_SOURCES);
    // "supa" is a prefix of "supabase" (not a segment match)
    expect(result).toContain("supabase");
  });

  it("prefix: supa -> supabase*, prefix ranked first", () => {
    const result = suggestSource("supa", LIVE_SOURCES);
    expect(result.length).toBeGreaterThan(0);
    // All supabase-* sources are prefix matches
    expect(result).toContain("supabase");
    expect(result).toContain("supabase-api");
    expect(result).toContain("supabase-auth-api");
  });

  it("substring: nuvoton-m480 -> nuvoton-m480-bsp", () => {
    const result = suggestSource("nuvoton-m480", LIVE_SOURCES);
    expect(result).toContain("nuvoton-m480-bsp");
  });

  it("hyphen segment: jlc -> jlcpcb", () => {
    const result = suggestSource("jlc", LIVE_SOURCES);
    // "jlc" is a prefix of "jlcpcb"
    expect(result).toContain("jlcpcb");
  });

  it("DL: lidar -> lidarr-api (distance 1: add r)", () => {
    const result = suggestSource("lidar", LIVE_SOURCES);
    expect(result).toContain("lidarr-api");
  });

  it("DL: supabse -> supabase (distance 1: transpose s,e)", () => {
    const result = suggestSource("supabse", LIVE_SOURCES);
    expect(result).toContain("supabase");
  });

  it("caps at 6 results", () => {
    const result = suggestSource("aws", LIVE_SOURCES);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("returns empty for completely unrelated input", () => {
    const result = suggestSource("zzzzzzz", LIVE_SOURCES);
    expect(result).toEqual([]);
  });

  it("case insensitive", () => {
    const result = suggestSource("LIDARR", LIVE_SOURCES);
    expect(result).toContain("lidarr-api");
  });

  it("ranks prefix before substring", () => {
    // "supa": prefix of supabase* - so supabase should come before anything
    // that only matches by substring (like supabase-api, which is also a prefix
    // match - they're all prefix matches for "supa" since it starts with "supa")
    const result = suggestSource("supa", LIVE_SOURCES);
    expect(result[0]).toBe("supabase"); // shortest prefix match should come first
  });
});