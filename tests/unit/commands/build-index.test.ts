import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildRow, buildIndex, rowsToTsv } from "../../../src/commands/build-index.js";

describe("build-index: buildRow", () => {
  it("extracts title and description from YAML frontmatter", () => {
    const md = [
      "---",
      "title: Auth Quickstart",
      "description: How to wire up auth in five minutes.",
      "---",
      "",
      "# Auth Quickstart",
      "",
      "Body text here.",
    ].join("\n");
    const row = buildRow("supabase/auth.md", md);
    expect(row.title).toBe("Auth Quickstart");
    expect(row.summary).toContain("How to wire up auth in five minutes.");
  });

  it("uses first ATX heading as title when frontmatter has none", () => {
    const md = "# Real Title\n\nSome content.";
    const row = buildRow("foo/bar.md", md);
    expect(row.title).toBe("Real Title");
  });

  it("falls back to first prose line when no heading and no frontmatter", () => {
    const md = "Just a sentence of prose, nothing else.";
    const row = buildRow("foo.md", md);
    expect(row.title).toBe("Just a sentence of prose, nothing else.");
  });

  it("handles YAML block scalar `description: >-` (folded, no trailing newline)", () => {
    // The previous awk implementation lost everything after the first
    // line of a folded block scalar; js-yaml handles it correctly.
    const md = [
      "---",
      "title: Folded Desc",
      "description: >-",
      "  Line one continues",
      "  onto line two as one paragraph.",
      "---",
      "# Folded Desc",
      "",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Folded Desc");
    expect(row.summary).toContain("Line one continues onto line two as one paragraph.");
  });

  it("handles YAML literal block scalar `description: |`", () => {
    const md = [
      "---",
      "title: Literal Desc",
      "description: |",
      "  Two lines here",
      "  preserved as-is.",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.summary).toContain("Two lines here");
  });

  it("literal block scalar newlines become spaces - one TSV row per file", () => {
    // A literal `description: |` block parses to a string with embedded
    // \n. If those survive into the index row, downstream awk/rg
    // consumers over _index.tsv mis-read the continuation lines as rows.
    const md = [
      "---",
      "title: Literal Desc",
      "description: |",
      "  Two lines here",
      "  preserved as-is.",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.summary).not.toContain("\n");
    expect(row.title).not.toContain("\n");
    expect(row.summary).toContain("Two lines here preserved as-is.");
  });

  it("supports `oneline` as a description alias", () => {
    const md = [
      "---",
      "title: Page",
      "oneline: One-sentence summary.",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.summary).toContain("One-sentence summary.");
  });

  it("prefers `description` over `oneline` when both present", () => {
    const md = [
      "---",
      "title: Page",
      "description: Real description.",
      "oneline: Fallback alias.",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.summary).toContain("Real description.");
    expect(row.summary).not.toContain("Fallback alias.");
  });

  it("strips quotes from string values handled by js-yaml", () => {
    const md = [
      `---`,
      `title: "Quoted Title"`,
      `description: 'Single-quoted desc.'`,
      `---`,
      `Body.`,
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Quoted Title");
    expect(row.summary).toContain("Single-quoted desc.");
  });

  it("ignores '#' inside fenced code blocks for heading extraction", () => {
    const md = [
      "```bash",
      "# This is a comment, not a heading",
      "echo hi",
      "```",
      "",
      "# Actual Title",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Actual Title");
  });

  it("also handles ~~~ fence delimiters", () => {
    const md = [
      "~~~bash",
      "# inside tilde fence",
      "~~~",
      "# Real Heading",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Real Heading");
  });

  it("collects up to 5 headings into the summary fallback", () => {
    const md = [
      "# H1",
      "## H2",
      "### H3",
      "#### H4",
      "##### H5",
      "###### H6 should not appear",
      "",
      "Some body prose with words.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.summary).toContain("H1");
    expect(row.summary).toContain("H5");
    expect(row.summary).not.toContain("H6");
  });

  it("strips ANSI escape sequences from title and summary", () => {
    // ESC [ 31 m … ESC [ 0 m — red colour wrappers
    const md = [
      "---",
      "title: \u001b[31mDangerous Title\u001b[0m",
      "description: \u001b[33mYellow summary\u001b[0m text.",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Dangerous Title");
    expect(row.summary).toContain("Yellow summary text.");
    expect(row.title).not.toMatch(/\x1b/);
    expect(row.summary).not.toMatch(/\x1b/);
  });

  it("replaces tabs with spaces (TSV would otherwise break)", () => {
    const md = [
      "---",
      "title: Has\ta\ttab",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Has a tab");
    expect(row.title).not.toContain("\t");
  });

  it("strips \\r and other control chars from sanitised fields", () => {
    const md = [
      "---",
      "title: Title\r\u0001\u0007 with junk",
      "---",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Title with junk");
  });

  it("caps title at 200 chars", () => {
    const big = "x".repeat(500);
    const md = `---\ntitle: ${big}\n---\nBody.`;
    const row = buildRow("p.md", md);
    expect(row.title.length).toBeLessThanOrEqual(200);
  });

  it("caps summary at 300 chars", () => {
    const big = "x ".repeat(400);
    const md = `---\ntitle: T\ndescription: ${big}\n---\nBody.`;
    const row = buildRow("p.md", md);
    expect(row.summary.length).toBeLessThanOrEqual(300);
  });

  it("extracts title and description from TOML (`+++`) frontmatter", () => {
    // Hugo TOML frontmatter - used by the Souin docs.
    const md = [
      "+++",
      "weight = 502",
      'title = "Caddy"',
      'description = "Use Souin directly in the Caddy web server"',
      "+++",
      "",
      "## Usage",
      "",
      "Body text here.",
    ].join("\n");
    const row = buildRow("souin/middlewares/caddy.md", md);
    expect(row.title).toBe("Caddy");
    expect(row.summary).toContain("Use Souin directly in the Caddy web server");
  });

  it("excludes TOML frontmatter lines from the content scan", () => {
    // Without `+++` recognition, `weight = 502` and friends leak into
    // the heading/prose heuristics and pollute the summary.
    const md = [
      "+++",
      "weight = 502",
      'title = "Storages"',
      "+++",
      "",
      "## Badger",
      "",
      "Badger is an embeddable KV store.",
    ].join("\n");
    const row = buildRow("souin/storages/badger.md", md);
    expect(row.title).toBe("Storages");
    expect(row.summary).not.toContain("weight");
    expect(row.summary).toContain("Badger");
  });

  it("falls back to first heading when TOML frontmatter has no title", () => {
    const md = [
      "+++",
      "weight = 10",
      "+++",
      "",
      "# Real Heading",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Real Heading");
  });

  it("treats unclosed `+++` frontmatter as content", () => {
    const md = [
      "+++",
      'title = "Never Closed"',
      "",
      "# Real Heading",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Real Heading");
  });

  it("accepts single-quoted TOML string values", () => {
    const md = [
      "+++",
      "title = 'Quickstart'",
      "+++",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Quickstart");
  });

  it("treats unclosed frontmatter as content", () => {
    // No second `---` line — awk previously kept consuming until EOF.
    // We follow the same rule (return null, scan whole file).
    const md = [
      "---",
      "title: Never Closed",
      "",
      "# Real Heading",
      "",
      "Body.",
    ].join("\n");
    const row = buildRow("p.md", md);
    // Frontmatter wasn't parsed → title comes from the heading.
    expect(row.title).toBe("Real Heading");
  });

  it("emits empty fields for an empty file", () => {
    const row = buildRow("empty.md", "");
    expect(row.path).toBe("empty.md");
    expect(row.title).toBe("");
    expect(row.summary).toContain(""); // never throws
  });

  it("survives malformed YAML in frontmatter without throwing", () => {
    const md = [
      "---",
      "title: [unclosed array",
      "---",
      "# Heading",
    ].join("\n");
    const row = buildRow("p.md", md);
    // YAML parse failed → no title from frontmatter → falls back to heading.
    expect(row.title).toBe("Heading");
  });

  it("skips first-prose-line heuristic on lines starting with markdown syntax", () => {
    const md = [
      "- bullet line first",
      "",
      "# Real Heading",
      "",
      "Real prose here.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Real Heading");
    expect(row.summary).toContain("Real prose here.");
  });

  it("trims leading/trailing whitespace from summary regardless of file shape", () => {
    // Files without ATX headings hit the `headings + content` branch
    // with an empty headings string, which would otherwise leave a
    // leading space ahead of the prose snippet.
    const headingless = buildRow("readme.md", "Some standalone prose without a heading.");
    expect(headingless.summary).toBe("Some standalone prose without a heading.");
    expect(headingless.summary.startsWith(" ")).toBe(false);

    // Files with headings AND prose stay clean too.
    const withHeading = buildRow("p.md", "# Title\n\nBody text here.");
    expect(withHeading.summary.startsWith(" ")).toBe(false);
    expect(withHeading.summary.endsWith(" ")).toBe(false);
  });

  it("requires at least 3 alpha chars in the first prose line", () => {
    // Lines like `42` or `[](url)` shouldn't qualify
    const md = [
      "42",
      "",
      "Real content has words here.",
    ].join("\n");
    const row = buildRow("p.md", md);
    expect(row.title).toBe("Real content has words here.");
  });
});

describe("build-index: buildIndex (filesystem walk)", () => {
  it("emits one row per markdown file, sorted lexicographically", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "build-idx-"));
    try {
      await fs.mkdir(path.join(tmp, "supabase"), { recursive: true });
      await fs.mkdir(path.join(tmp, "postgres"), { recursive: true });
      await fs.writeFile(path.join(tmp, "supabase", "auth.md"), "# Auth\n\nAuth docs.");
      await fs.writeFile(path.join(tmp, "postgres", "rls.md"), "# RLS\n\nRow security.");
      // Non-markdown — must be skipped.
      await fs.writeFile(path.join(tmp, "README.txt"), "ignore me");

      const rows = await buildIndex(tmp);
      expect(rows).toHaveLength(2);
      expect(rows[0].path).toBe("postgres/rls.md");
      expect(rows[1].path).toBe("supabase/auth.md");
      expect(rows[0].title).toBe("RLS");
      expect(rows[1].title).toBe("Auth");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rowsToTsv emits trailing newline and tab-separated fields", () => {
    const tsv = rowsToTsv([{ path: "a.md", title: "A", summary: "Alpha" }]);
    expect(tsv).toBe("a.md\tA\tAlpha\n");
  });

  it("rowsToTsv emits empty string for empty input", () => {
    expect(rowsToTsv([])).toBe("");
  });
});
