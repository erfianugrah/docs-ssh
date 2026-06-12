import { describe, it, expect } from "vitest";
import { forQuotedHeredoc, generate } from "../../../src/commands/generate-tools-pi-sh.js";

describe("forQuotedHeredoc (pi)", () => {
  it("returns the input unchanged when delimiter absent", () => {
    const safe = "function foo() {\n  return 1;\n}";
    expect(forQuotedHeredoc(safe)).toBe(safe);
  });

  it("allows the delimiter substring inside a longer identifier", () => {
    const embedded = "const x = 'PI_STATIC_VAR';";
    expect(forQuotedHeredoc(embedded)).toBe(embedded);
  });

  it("throws if content contains delimiter on its own line", () => {
    const bad = "foo\nPI_STATIC\nbar";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content starts with delimiter on its own line", () => {
    const bad = "PI_STATIC\nfoo";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content ends with delimiter on its own line", () => {
    const bad = "foo\nPI_STATIC";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content is exactly the delimiter", () => {
    expect(() => forQuotedHeredoc("PI_STATIC")).toThrow(/heredoc delimiter/);
  });
});

describe("generate() pi", () => {
  it("produces a valid shell script with the pi template", () => {
    const out = generate();
    expect(out).toContain("#!/bin/sh");
    expect(out).toContain("cat << PI_DYNAMIC");
    expect(out).toContain("cat << 'PI_STATIC'");
  });

  it("contains pi-specific imports in dynamic section", () => {
    const out = generate();
    expect(out).toContain("@earendil-works/pi-ai");
    expect(out).toContain("@earendil-works/pi-coding-agent");
  });

  it("contains all 6 tool definitions", () => {
    const out = generate();
    for (const name of ["docs_search", "docs_read", "docs_find", "docs_grep", "docs_summary", "docs_sources"]) {
      expect(out).toContain(name);
    }
  });

  it("contains the default export registering all tools", () => {
    const out = generate();
    expect(out).toContain("export default function");
    expect(out).toContain("pi.registerTool");
  });

  it("injects HOST/PORT into the dynamic header", () => {
    const out = generate();
    expect(out).toContain('docs@${HOST}');
    expect(out).toContain("${PORT}");
  });
});
