import { describe, it, expect } from "vitest";
import { SOURCES } from "../../../src/application/sources.js";

describe("SOURCES configuration", () => {
  it("constructs all sources without error", () => {
    // If any DocSource config is invalid, this import would have thrown
    expect(SOURCES.length).toBeGreaterThan(0);
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
      "sitemap-index", "toc", "llms-index", "llms-txt", "rss",
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
