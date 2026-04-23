import { describe, it, expect } from "vitest";
import { SOURCES } from "../../../src/application/sources.js";

describe("SOURCES configuration", () => {
  it("constructs all sources without error", () => {
    // If any DocSource config is invalid, this import would have thrown
    expect(SOURCES.length).toBeGreaterThan(0);
  });

  it("has the expected number of sources", () => {
    // Bump this when adding/removing sources to catch accidental deletions
    expect(SOURCES.length).toBe(112);
  });

  it("has unique source names", () => {
    const names = SOURCES.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("has non-empty URLs for all sources", () => {
    for (const source of SOURCES) {
      expect(source.url).toBeTruthy();
      expect(source.url.startsWith("https://")).toBe(true);
    }
  });

  it("has valid discovery methods", () => {
    const validMethods = new Set([
      "none", "tarball", "llms-full", "sitemap",
      "sitemap-index", "toc", "llms-index", "llms-txt", "rss", "openapi", "openapi-dir",
    ]);
    for (const source of SOURCES) {
      expect(validMethods.has(source.discovery)).toBe(true);
    }
  });

  it("has discoveryUrl for sources that need it", () => {
    for (const source of SOURCES) {
      if (source.discovery !== "none" && source.type === "http") {
        expect(source.discoveryUrl).toBeTruthy();
      }
    }
  });

  // ─── Format ↔ discovery coherence ────────────────────────────────

  it("llms-full sources use markdown format", () => {
    const llmsFullSources = SOURCES.filter((s) => s.discovery === "llms-full");
    expect(llmsFullSources.length).toBeGreaterThan(0);
    for (const source of llmsFullSources) {
      expect(source.format).toBe("markdown");
    }
  });

  it("openapi sources use openapi format", () => {
    const openapiSources = SOURCES.filter(
      (s) => s.discovery === "openapi" || s.discovery === "openapi-dir",
    );
    expect(openapiSources.length).toBeGreaterThan(0);
    for (const source of openapiSources) {
      expect(source.format).toBe("openapi");
    }
  });

  it("sitemap and sitemap-index sources use html format (unless urlSuffix fetches markdown)", () => {
    const sitemapSources = SOURCES.filter(
      (s) => s.discovery === "sitemap" || s.discovery === "sitemap-index",
    );
    expect(sitemapSources.length).toBeGreaterThan(0);
    for (const source of sitemapSources) {
      // Sources with urlSuffix ".md" fetch raw markdown from sitemap-discovered URLs
      if (source.urlSuffix?.endsWith(".md")) {
        expect(source.format).toBe("markdown");
      } else {
        expect(source.format).toBe("html");
      }
    }
  });

  it("toc sources use html format", () => {
    const tocSources = SOURCES.filter((s) => s.discovery === "toc");
    expect(tocSources.length).toBeGreaterThan(0);
    for (const source of tocSources) {
      expect(source.format).toBe("html");
    }
  });

  it("rss sources use html format", () => {
    const rssSources = SOURCES.filter((s) => s.discovery === "rss");
    expect(rssSources.length).toBeGreaterThan(0);
    for (const source of rssSources) {
      expect(source.format).toBe("html");
    }
  });

  it("git sources use markdown, mdx, or openapi format", () => {
    const gitSources = SOURCES.filter((s) => s.type === "git");
    expect(gitSources.length).toBeGreaterThan(0);
    for (const source of gitSources) {
      expect(["markdown", "mdx", "openapi"]).toContain(source.format);
    }
  });

  // ─── Regex validation ────────────────────────────────────────────

  it("urlPattern values are valid regexes", () => {
    for (const source of SOURCES) {
      if (source.urlPattern) {
        expect(() => new RegExp(source.urlPattern!)).not.toThrow();
      }
    }
  });

  it("urlExclude values are valid regexes", () => {
    for (const source of SOURCES) {
      if (source.urlExclude) {
        expect(() => new RegExp(source.urlExclude!)).not.toThrow();
      }
    }
  });

  // ─── Personal blog sources ───────────────────────────────────────

  it("includes the two personal blog sources", () => {
    const names = SOURCES.map((s) => s.name);
    expect(names).toContain("erfi-technical-blog");
    expect(names).toContain("erfi-personal-blog");
  });

  it("personal blog sources are git type with mdx format", () => {
    const techBlog = SOURCES.find((s) => s.name === "erfi-technical-blog")!;
    const personalBlog = SOURCES.find((s) => s.name === "erfi-personal-blog")!;

    expect(techBlog.type).toBe("git");
    expect(techBlog.format).toBe("mdx");
    expect(techBlog.paths.length).toBeGreaterThan(0);

    expect(personalBlog.type).toBe("git");
    expect(personalBlog.format).toBe("mdx");
    expect(personalBlog.paths.length).toBeGreaterThan(0);
  });
});
