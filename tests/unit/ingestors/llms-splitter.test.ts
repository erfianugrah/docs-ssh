import { describe, it, expect } from "vitest";
import {
  splitLlmsFull,
  splitVercelStyle,
  splitFrontmatterStyle,
} from "../../../src/ingestors/llms-splitter.js";

describe("splitVercelStyle", () => {
  it("splits a basic vercel-style llms-full.txt", () => {
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Functions"',
      'description: "Run server-side code."',
      'source: "https://vercel.com/docs/functions"',
      "--------------------------------------------------------------------------------",
      "",
      "# Functions",
      "",
      "Run server-side code on Vercel.",
      "",
      "--------------------------------------------------------------------------------",
      'title: "Edge Functions"',
      'description: "Run at the edge."',
      'source: "https://vercel.com/docs/functions/edge"',
      "--------------------------------------------------------------------------------",
      "",
      "# Edge Functions",
      "",
      "Deploy functions to the edge network.",
    ].join("\n");

    const pages = splitVercelStyle(content, "https://vercel.com/docs/");
    expect(pages.size).toBe(2);
    expect(pages.has("functions.md")).toBe(true);
    expect(pages.has("functions/edge.md")).toBe(true);
    expect(pages.get("functions.md")).toContain("# Functions");
    expect(pages.get("functions/edge.md")).toContain("Deploy functions");
  });

  it("handles source URL matching the base URL exactly", () => {
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Docs Home"',
      'source: "https://vercel.com/docs/"',
      "--------------------------------------------------------------------------------",
      "",
      "# Welcome",
    ].join("\n");

    const pages = splitVercelStyle(content, "https://vercel.com/docs/");
    expect(pages.size).toBe(1);
    expect(pages.has("index.md")).toBe(true);
  });

  it("returns empty map for content with no separators", () => {
    const pages = splitVercelStyle("just some text", "https://example.com/");
    expect(pages.size).toBe(0);
  });

  it("skips metadata blocks without source", () => {
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Orphan"',
      "--------------------------------------------------------------------------------",
      "",
      "# Orphan content",
    ].join("\n");

    const pages = splitVercelStyle(content, "https://example.com/");
    expect(pages.size).toBe(0);
  });
});

describe("splitFrontmatterStyle", () => {
  it("splits a basic cloudflare-style llms-full.txt", () => {
    const content = [
      "---",
      "title: Workers",
      "description: Build serverless apps.",
      "---",
      "",
      "# Workers",
      "",
      "Build and deploy serverless applications.",
      "",
      "---",
      "title: KV",
      "description: Key-value storage.",
      "---",
      "",
      "# KV",
      "",
      "Global low-latency key-value storage.",
    ].join("\n");

    const pages = splitFrontmatterStyle(content, "https://developers.cloudflare.com/");
    expect(pages.size).toBe(2);
    expect(pages.has("workers.md")).toBe(true);
    expect(pages.has("kv.md")).toBe(true);
    expect(pages.get("workers.md")).toContain("Build and deploy");
    expect(pages.get("kv.md")).toContain("key-value storage");
  });

  it("slugifies titles correctly", () => {
    const content = [
      "---",
      "title: Argo Smart Routing",
      "---",
      "",
      "Content here.",
    ].join("\n");

    const pages = splitFrontmatterStyle(content, "https://example.com/");
    expect(pages.has("argo-smart-routing.md")).toBe(true);
  });

  it("strips quotes from titles", () => {
    const content = [
      "---",
      'title: "Quoted Title"',
      "---",
      "",
      "Content.",
    ].join("\n");

    const pages = splitFrontmatterStyle(content, "https://example.com/");
    expect(pages.has("quoted-title.md")).toBe(true);
  });

  it("returns empty map for content without frontmatter", () => {
    const pages = splitFrontmatterStyle("just plain text\nno frontmatter here", "https://x.com/");
    expect(pages.size).toBe(0);
  });

  it("handles frontmatter with extra fields", () => {
    const content = [
      "---",
      "title: Page One",
      "description: Desc.",
      "image: https://example.com/img.png",
      "sidebar_position: 1",
      "---",
      "",
      "# Page One",
      "",
      "Content of page one.",
    ].join("\n");

    const pages = splitFrontmatterStyle(content, "https://example.com/");
    expect(pages.size).toBe(1);
    expect(pages.get("page-one.md")).toContain("Content of page one");
  });

  it("does not confuse markdown horizontal rules with frontmatter", () => {
    const content = [
      "---",
      "title: Page",
      "---",
      "",
      "# Page",
      "",
      "Some text above the rule.",
      "",
      "---",
      "",
      "Some text below the rule.",
      // No second frontmatter — that --- is an <hr>
    ].join("\n");

    // This is tricky: a lone --- in content could be confused with frontmatter.
    // The splitter should only match --- followed by key: value lines.
    const pages = splitFrontmatterStyle(content, "https://example.com/");
    // It should produce 1 page. The content --- is ambiguous, but since
    // there's no title: after it, it shouldn't start a new page.
    expect(pages.size).toBe(1);
    expect(pages.get("page.md")).toContain("Some text above the rule");
  });
});

describe("splitFrontmatterStyle — real-world patterns", () => {
  it("handles CF-style content with --- HRs and JSON blocks between pages", () => {
    // This mirrors the actual Cloudflare llms-full.txt structure
    const content = [
      "---",
      "title: Argo Smart Routing",
      "description: Speed up traffic.",
      "---",
      "",
      "# Argo Smart Routing",
      "",
      "Speed up your global traffic.",
      "",
      "---",
      "",
      "## Features",
      "",
      "Argo includes analytics.",
      "",
      "---",
      "",
      "## Related products",
      "",
      "```json",
      '{"@context":"https://schema.org"}',
      "```",
      "",
      "---",
      "",
      "---",
      "title: Get started",
      "description: Learn how to enable Argo.",
      "---",
      "",
      "# Get started",
      "",
      "Enable Argo in the dashboard.",
    ].join("\n");

    const pages = splitFrontmatterStyle(content, "https://developers.cloudflare.com/");
    expect(pages.size).toBe(2);
    expect(pages.has("argo-smart-routing.md")).toBe(true);
    expect(pages.has("get-started.md")).toBe(true);
    expect(pages.get("argo-smart-routing.md")).toContain("Speed up your global traffic");
    expect(pages.get("argo-smart-routing.md")).toContain("## Features");
    expect(pages.get("get-started.md")).toContain("Enable Argo");
  });
});

describe("splitLlmsFull (auto-detect)", () => {
  it("detects Vercel style when source: metadata is present between long dashes", () => {
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Test"',
      'source: "https://vercel.com/docs/test"',
      "--------------------------------------------------------------------------------",
      "",
      "# Test content",
    ].join("\n");

    const pages = splitLlmsFull(content, "https://vercel.com/docs/");
    expect(pages.size).toBe(1);
    expect(pages.has("test.md")).toBe(true);
  });

  it("detects Cloudflare style when only YAML frontmatter is present", () => {
    const content = [
      "---",
      "title: Workers",
      "description: Serverless.",
      "---",
      "",
      "# Workers",
      "",
      "Build serverless apps.",
    ].join("\n");

    const pages = splitLlmsFull(content, "https://developers.cloudflare.com/");
    expect(pages.size).toBe(1);
    expect(pages.has("workers.md")).toBe(true);
  });

  it("does not misdetect CF content with long dashes as Vercel style", () => {
    // Cloudflare docs can contain long dash lines in markdown content
    // but they won't have source: metadata after them
    const content = [
      "---",
      "title: Page A",
      "---",
      "",
      "# Page A",
      "",
      "Some content with a divider:",
      "",
      "------------------------------------------------------------",
      "",
      "More content after the divider.",
      "",
      "---",
      "title: Page B",
      "---",
      "",
      "# Page B",
      "",
      "Second page.",
    ].join("\n");

    const pages = splitLlmsFull(content, "https://example.com/");
    expect(pages.size).toBe(2);
    expect(pages.has("page-a.md")).toBe(true);
    expect(pages.has("page-b.md")).toBe(true);
    // Page A should include the divider content, not split on it
    expect(pages.get("page-a.md")).toContain("content with a divider");
    expect(pages.get("page-a.md")).toContain("More content after the divider");
  });
});
