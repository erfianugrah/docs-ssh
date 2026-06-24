import { describe, it, expect } from "vitest";
import { splitTexinfo } from "../../../src/ingestors/info-splitter.js";

const US = "\x1f"; // info node separator

/** Build a node chunk with the standard info header. */
function node(id: string, body: string, opts: { next?: string; prev?: string; up?: string } = {}): string {
  const { next = "x", prev = "y", up = "Top" } = opts;
  return `${US}\nFile: manual.info.tmp,  Node: ${id},  Next: ${next},  Prev: ${prev},  Up: ${up}\n\n${body}`;
}

describe("splitTexinfo", () => {
  it("splits nodes on the 0x1f separator and names files by node id", () => {
    const content =
      "preamble before first separator\n" +
      node("select", "15.2.13 SELECT Statement\n------------------------\n\nBody text.") +
      node("introduction", "Introduction\n============\n\nMore text.");
    const pages = splitTexinfo(content);
    expect(pages.has("select.md")).toBe(true);
    expect(pages.has("introduction.md")).toBe(true);
    // Preamble (no Node: header) is skipped.
    expect(pages.size).toBe(2);
  });

  it("maps the Top node to index.md with a readable title", () => {
    const content = node("Top", "* Menu:\n\n* preface::   Preface\n", { up: "(dir)" });
    const pages = splitTexinfo(content);
    expect(pages.has("index.md")).toBe(true);
    expect(pages.get("index.md")).toContain("# MySQL Reference Manual");
  });

  it("skips trailing sections without a Node: header (Tag Table)", () => {
    const content =
      node("select", "SELECT\n======\n\nbody") +
      `${US}\nTag Table:\nNode: select\x7f123\n${US}\nEnd Tag Table`;
    const pages = splitTexinfo(content);
    expect(pages.size).toBe(1);
    expect(pages.has("select.md")).toBe(true);
  });

  it("converts setext underlines to ATX headings, normalising the top heading to H1", () => {
    // A leaf node whose title uses a deep `-` underline should still
    // become H1 (min-level normalisation), with the section number stripped.
    const pages = splitTexinfo(node("select", "15.2.13 SELECT Statement\n------------------------\n\nbody"));
    const md = pages.get("select.md")!;
    expect(md).toContain("# SELECT Statement");
    expect(md).not.toContain("15.2.13");
    expect(md).not.toContain("------");
  });

  it("preserves relative heading nesting beneath the top heading", () => {
    const body =
      "Big Section\n===========\n\nintro\n\nSub Part\n--------\n\ndetail";
    const md = splitTexinfo(node("x", body)).get("x.md")!;
    expect(md).toContain("# Big Section");
    expect(md).toContain("## Sub Part");
  });

  it("converts a menu into a markdown bullet list of links", () => {
    const body = "* Menu:\n\n* select-into::    SELECT ... INTO Statement\n* join::          JOIN Clause\n";
    const md = splitTexinfo(node("select", body)).get("select.md")!;
    expect(md).toContain("- [SELECT ... INTO Statement](select-into.md)");
    expect(md).toContain("- [JOIN Clause](join.md)");
    expect(md).not.toContain("* Menu:");
  });

  it("does not swallow an indented code block that follows a menu", () => {
    const body =
      "* Menu:\n\n* sub::   Sub\n\n     SELECT\n         FROM t\n         WHERE x = 1\n";
    const md = splitTexinfo(node("select", body)).get("select.md")!;
    expect(md).toContain("- [Sub](sub.md)");
    // The indented SELECT block must survive intact, not be appended to
    // the bullet.
    expect(md).toMatch(/SELECT\n {9}FROM t/);
  });

  it("converts inline *note cross-references (both forms, comma and period)", () => {
    const body =
      "Title\n=====\n\n" +
      "See *note installing:: for setup. " +
      "Compare *note 'FLOAT': floating-point-types, and *note 'DOUBLE': floating-point-types.";
    const md = splitTexinfo(node("x", body)).get("x.md")!;
    expect(md).toContain("[installing](installing.md)");
    expect(md).toContain("['FLOAT'](floating-point-types.md),");
    expect(md).toContain("['DOUBLE'](floating-point-types.md).");
    expect(md).not.toMatch(/\*note/);
  });

  it("leaves *Note* bold markup untouched (not a cross-reference)", () => {
    const md = splitTexinfo(node("x", "Title\n=====\n\n*Note*: this is emphasis.")).get("x.md")!;
    expect(md).toContain("*Note*: this is emphasis.");
  });

  it("strips the 0x1f separator byte from output", () => {
    const md = splitTexinfo(node("x", "Title\n=====\n\nbody")).get("x.md")!;
    expect(md).not.toContain("\x1f");
  });

  it("guarantees a leading H1 when a node has no heading", () => {
    const md = splitTexinfo(node("string-functions", "Just a paragraph with no heading.")).get(
      "string-functions.md",
    )!;
    expect(md.startsWith("# String Functions\n")).toBe(true);
  });
});
