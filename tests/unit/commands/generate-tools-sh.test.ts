import { describe, it, expect } from "vitest";
import { forQuotedHeredoc, generate } from "../../../src/commands/generate-tools-sh.js";

describe("forQuotedHeredoc", () => {
  it("returns the input unchanged when delimiter absent", () => {
    const safe = "function foo() {\n  return 1;\n}";
    expect(forQuotedHeredoc(safe)).toBe(safe);
  });

  it("allows the delimiter substring inside a longer identifier", () => {
    // Only whole-line occurrences prematurely close the heredoc.
    const embedded = "const x = 'TOOLS_STATIC_VAR';";
    expect(forQuotedHeredoc(embedded)).toBe(embedded);
  });

  it("throws if content contains delimiter on its own line", () => {
    const bad = "foo\nTOOLS_STATIC\nbar";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content starts with delimiter on its own line", () => {
    const bad = "TOOLS_STATIC\nfoo";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content ends with delimiter on its own line", () => {
    const bad = "foo\nTOOLS_STATIC";
    expect(() => forQuotedHeredoc(bad)).toThrow(/heredoc delimiter/);
  });

  it("throws if content is exactly the delimiter", () => {
    expect(() => forQuotedHeredoc("TOOLS_STATIC")).toThrow(/heredoc delimiter/);
  });
});

describe("generate()", () => {
  it("produces a valid shell script with the live template", () => {
    const out = generate();
    expect(out).toContain("#!/bin/sh");
    expect(out).toContain("cat << TOOLS_DYNAMIC");
    expect(out).toContain("cat << 'TOOLS_STATIC'");
  });
});
