import { describe, it, expect } from "vitest";
import {
  splitLlmsFull,
  splitVercelStyle,
  splitFrontmatterStyle,
  splitHeadingStyle,
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

  it("injects H1 from title metadata when content doesn't already start with one", () => {
    // Defensive: if Vercel ever drops the inline '# Title' from content
    // blocks, titles would vanish. Inject the title as an H1 prefix
    // when missing so downstream readers always have a heading.
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Functions"',
      'source: "https://vercel.com/docs/functions"',
      "--------------------------------------------------------------------------------",
      "",
      "Run server-side code on Vercel. (no inline heading)",
    ].join("\n");

    const pages = splitVercelStyle(content, "https://vercel.com/docs/");
    const fn = pages.get("functions.md");
    expect(fn).toBeDefined();
    expect(fn!.startsWith("# Functions")).toBe(true);
    expect(fn).toContain("Run server-side code");
  });

  it("does not duplicate H1 when content already has one matching the title", () => {
    // Current Vercel format includes '# Title' in the content body. We
    // must not prepend a second '# Title' — otherwise we'd double the
    // heading on every page.
    const content = [
      "--------------------------------------------------------------------------------",
      'title: "Functions"',
      'source: "https://vercel.com/docs/functions"',
      "--------------------------------------------------------------------------------",
      "",
      "# Functions",
      "",
      "Content here.",
    ].join("\n");

    const pages = splitVercelStyle(content, "https://vercel.com/docs/");
    const fn = pages.get("functions.md")!;
    // Exactly one H1 line starting with "# "
    const h1Lines = fn.split("\n").filter((l) => /^# /.test(l));
    expect(h1Lines).toHaveLength(1);
  });
});

describe("splitFrontmatterStyle (dedup stability)", () => {
  it("dedup suffix reflects page index, not the mutating map size", () => {
    // Reproduces the stability concern: a page with empty body is
    // skipped (see `if (!pageContent || !title) continue`), which
    // keeps idx advancing but leaves pages.size unchanged. The
    // collision suffix must not shift in response — it should track
    // the page's own idx so adding or removing unrelated empty blocks
    // earlier in the file doesn't rename downstream collision pages.
    //
    // Sequence: A(idx=0), B(idx=1), [EMPTY skipped](idx=2), A(idx=3)
    // With pages.size-based suffix: second A becomes 'a-2.md'
    // (pages.size=2 at that point).
    // With idx-based suffix: second A becomes 'a-3.md' (idx=3),
    // stable regardless of whether the empty block existed.
    const content = [
      "---\ntitle: A\n---\n\nA1 content.\n\n",
      "---\ntitle: B\n---\n\nB content.\n\n",
      "---\ntitle: Skipped\n---\n\n", // no body → skipped
      "---\ntitle: A\n---\n\nA2 content.",
    ].join("");

    const pages = splitFrontmatterStyle(content, "https://example.com/");
    expect(pages.has("a.md")).toBe(true);
    expect(pages.has("b.md")).toBe(true);
    // idx-based suffix: a-3.md (page was at idx=3). Stable across
    // additions/removals of earlier skipped blocks.
    expect(pages.has("a-3.md")).toBe(true);
    expect(pages.size).toBe(3);
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

describe("splitHeadingStyle", () => {
  it("splits continuous document on top-level headings", () => {
    const content = [
      "# Why Astro?",
      "",
      "Astro is an all-in-one web framework.",
      "",
      "# Getting Started",
      "",
      "Install Astro with npm.",
      "",
      "# Components",
      "",
      "Astro components use .astro syntax.",
    ].join("\n");

    const pages = splitHeadingStyle(content);
    expect(pages.size).toBe(3);
    expect(pages.has("why-astro.md")).toBe(true);
    expect(pages.has("getting-started.md")).toBe(true);
    expect(pages.has("components.md")).toBe(true);
    expect(pages.get("why-astro.md")).toContain("all-in-one web framework");
    expect(pages.get("getting-started.md")).toContain("Install Astro");
  });

  it("preserves heading in page content", () => {
    const content = "# My Page\n\nContent here.";
    const pages = splitHeadingStyle(content);
    expect(pages.get("my-page.md")).toContain("# My Page");
  });

  it("does not split on ## subheadings", () => {
    const content = [
      "# Page One",
      "",
      "Intro.",
      "",
      "## Subsection",
      "",
      "More content.",
    ].join("\n");

    const pages = splitHeadingStyle(content);
    expect(pages.size).toBe(1);
    expect(pages.get("page-one.md")).toContain("## Subsection");
  });

  it("handles duplicate heading titles with suffix", () => {
    const content = [
      "# Overview",
      "",
      "First overview.",
      "",
      "# Overview",
      "",
      "Second overview.",
    ].join("\n");

    const pages = splitHeadingStyle(content);
    expect(pages.size).toBe(2);
  });

  it("returns empty map for content with no headings", () => {
    const pages = splitHeadingStyle("just plain text\nno headings");
    expect(pages.size).toBe(0);
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

  it("falls back to heading style for continuous documents without metadata", () => {
    const content = [
      "# Why Astro?",
      "",
      "Astro is great.",
      "",
      "# Getting Started",
      "",
      "Install with npm.",
      "",
      "# Islands",
      "",
      "Island architecture.",
    ].join("\n");

    // No frontmatter, no Vercel separators — should use heading style
    const pages = splitLlmsFull(content, "https://docs.astro.build/");
    expect(pages.size).toBe(3);
    expect(pages.has("why-astro.md")).toBe(true);
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
