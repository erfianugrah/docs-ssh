import { describe, expect, it } from "vitest";
import {
  headingToSlug,
  sectionToMarkdown,
  splitPdfText,
  type PdfSection,
} from "../../../src/ingestors/pdf-splitter.js";

// Fixture: a minimal 2-page pdftotext -layout output with form feeds.
// Page 1 has a numbered heading. Page 2 has an all-caps heading.
function makeTwoPageFixture(): string {
  return [
    "1.2 System Overview",
    "",
    "This section describes the overall system architecture.",
    "The CPU runs at 216 MHz with a single-precision FPU.",
    "",
    "\f",
    "",
    "MEMORY ORGANIZATION",
    "",
    "The device includes up to 256 KB of embedded Flash memory.",
    "SRAM is 96 KB plus 6 KB backup domain.",
    "",
  ].join("\n");
}

// Fixture: headingless text that should fall back to page-range chunks.
function makeHeadinglessFixture(pages: number): string {
  const ff = "\f";
  return Array.from(
    { length: pages },
    (_, i) => `Page ${i + 1} content line 1\nPage ${i + 1} content line 2\n${ff}`,
  ).join("\n");
}

const HEADINGLESS_FIXTURE = makeHeadinglessFixture(25);

describe("splitPdfText", () => {
  it("splits on numbered headings", () => {
    const sections = splitPdfText(makeTwoPageFixture(), "Test Manual", "http://example.com/test.pdf");
    expect(sections.length).toBe(2);
    expect(sections[0].heading).toBe("1.2 System Overview");
    expect(sections[0].firstPage).toBe(1);
    expect(sections[0].lastPage).toBe(1);
    expect(sections[1].heading).toBe("MEMORY ORGANIZATION");
    expect(sections[1].firstPage).toBe(2);
    expect(sections[1].lastPage).toBe(2);
  });

  it("falls back to page-range chunks when no headings found", () => {
    const sections = splitPdfText(HEADINGLESS_FIXTURE, "Empty Doc", "http://example.com/e.pdf");
    // 25 pages, 10 per chunk = 3 sections
    expect(sections.length).toBe(3);
    expect(sections[0].heading).toContain("pages 1-10");
    expect(sections[1].heading).toContain("pages 11-20");
    expect(sections[2].heading).toContain("pages 21-25");
  });

  it("returns empty array for empty text", () => {
    expect(splitPdfText("", "Empty", "http://x.com/e.pdf")).toEqual([]);
    expect(splitPdfText("   \n", "Empty", "http://x.com/e.pdf")).toEqual([]);
  });

  it("ignores Table/Figure prefixes in heading detection", () => {
    const text = [
      "Table 1. Register Map",
      "",
      "Some content",
      "\f",
      "3.1 Real Heading",
      "",
      "More content",
    ].join("\n");
    const sections = splitPdfText(text, "Doc", "http://x.com/d.pdf");
    // Page 1 has no valid heading → fallback section. Page 2 has real heading.
    expect(sections.length).toBe(2);
    expect(sections[0].heading).toContain("Doc (pages 1-1)");
    expect(sections[1].heading).toBe("3.1 Real Heading");
  });
});

describe("sectionToMarkdown", () => {
  it("produces markdown with H1, source note, and fenced body", () => {
    const section = {
      heading: "1.2 System Overview",
      firstPage: 1,
      lastPage: 1,
      lines: ["Line one", "", "Line two"],
    };
    const md = sectionToMarkdown(section, "Test Manual", "http://example.com/test.pdf");
    expect(md).toContain("# Test Manual - 1.2 System Overview");
    expect(md).toContain("> Source: http://example.com/test.pdf (page 1)");
    expect(md).toContain("```text");
    expect(md).toContain("Line one");
  });

  it("uses plural 'pages' for multi-page sections", () => {
    const section = {
      heading: "MEMORY ORGANIZATION",
      firstPage: 5,
      lastPage: 12,
      lines: ["Content"],
    };
    const md = sectionToMarkdown(section, "Test Manual", "http://example.com/test.pdf");
    expect(md).toContain("(pages 5-12)");
  });

  it("does not double the title in heading when it already starts with it", () => {
    const section = {
      heading: "Test Manual (pages 1-10)",
      firstPage: 1,
      lastPage: 10,
      lines: ["Content"],
    };
    const md = sectionToMarkdown(section, "Test Manual", "http://example.com/test.pdf");
    expect(md).toContain("# Test Manual (pages 1-10)");
    // Should not be "Test Manual - Test Manual (pages 1-10)"
    expect(md).not.toMatch(/^# Test Manual .+ Test Manual/);
  });
});

describe("headingToSlug", () => {
  it("converts numbered headings to filename-safe slugs", () => {
    expect(headingToSlug("5.3 USB full-speed device interface (USBFS)")).toBe(
      "5-3-usb-full-speed-device-interface-usbfs",
    );
  });

  it("handles all-caps headings", () => {
    expect(headingToSlug("MEMORY ORGANIZATION")).toBe("memory-organization");
  });

  it("handles chapter-style headings", () => {
    expect(headingToSlug("Chapter 10 General-purpose I/O")).toBe(
      "chapter-10-general-purpose-io",
    );
  });

  it("caps at 120 characters", () => {
    const long = "A".repeat(200);
    expect(headingToSlug(long).length).toBeLessThanOrEqual(120);
  });
});