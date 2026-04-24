import { describe, it, expect } from "vitest";
import {
  renderToolsTemplate,
  EXPECTED_EXPORTS,
  DYNAMIC_HEADER,
  STATIC_BODY,
  SEARCH_DESCRIPTION,
  SEARCH_BODY_STATIC,
  REMAINING_TOOLS,
} from "../../../src/commands/tools-template.js";

describe("tools-template", () => {
  const rendered = renderToolsTemplate({
    host: "docs.erfi.io",
    port: "2222",
  });

  // ─── Structure ─────────────────────────────────────────────────

  it("renders a non-empty string", () => {
    expect(rendered.length).toBeGreaterThan(100);
  });

  it("starts with zod import", () => {
    expect(rendered).toMatch(/^import { z } from "zod"/);
  });

  it("contains SSH_HOST with the provided host", () => {
    expect(rendered).toContain('const SSH_HOST = "docs@docs.erfi.io"');
  });

  it("contains SSH_PORT with the provided port", () => {
    expect(rendered).toContain('const SSH_PORT = "2222"');
  });

  it("contains MAX_RESULT_CHARS", () => {
    expect(rendered).toContain("const MAX_RESULT_CHARS = 51_200");
  });

  // ─── All expected exports present ──────────────────────────────

  for (const name of EXPECTED_EXPORTS) {
    it(`exports '${name}'`, () => {
      expect(rendered).toContain(`export const ${name}`);
    });
  }

  // ─── Helpers present ───────────────────────────────────────────

  it("contains sq() helper", () => {
    expect(rendered).toContain("function sq(s: string)");
  });

  it("contains safePath() helper", () => {
    expect(rendered).toContain("function safePath(p: string)");
  });

  it("contains capOutput() helper", () => {
    expect(rendered).toContain("function capOutput(text: string");
  });

  it("contains ssh() helper", () => {
    expect(rendered).toContain("async function ssh(command: string)");
  });

  // ─── rg --json parser ─────────────────────────────────────────

  it("contains RgMatch interface", () => {
    expect(rendered).toContain("interface RgMatch");
  });

  it("contains parseRgJson function", () => {
    expect(rendered).toContain("function parseRgJson(raw: string)");
  });

  it("contains formatRgMatches function", () => {
    expect(rendered).toContain("function formatRgMatches(matches: RgMatch[])");
  });

  // ─── bat integration ──────────────────────────────────────────

  it("uses bat for offset+limit reads with fallback", () => {
    expect(rendered).toContain("bat --plain --paging=never --color=never --line-range=");
    expect(rendered).toContain("|| sed -n");
  });

  it("uses bat for full reads with line numbers and fallback to cat", () => {
    expect(rendered).toContain("bat --decorations=always --paging=never --color=never --style=numbers");
    expect(rendered).toContain("|| cat");
  });

  // ─── rg --json in grep tool ───────────────────────────────────

  it("grep tool tries rg --json first", () => {
    expect(rendered).toContain("rg -i --json");
  });

  it("grep tool falls back to plain rg", () => {
    // The fallback path uses plain rg without --json
    const grepSection = rendered.slice(rendered.indexOf("export const grep"));
    expect(grepSection).toContain("Fallback to plain rg");
  });

  // ─── Search description ─────────────────────────────────────

  it("search description mentions pre-built index", () => {
    expect(rendered).toContain("pre-built index");
  });

  // ─── Template sections are non-empty ──────────────────────────

  it("DYNAMIC_HEADER is non-empty", () => {
    expect(DYNAMIC_HEADER.length).toBeGreaterThan(50);
  });

  it("STATIC_BODY is non-empty", () => {
    expect(STATIC_BODY.length).toBeGreaterThan(500);
  });

  it("SEARCH_DESCRIPTION is non-empty", () => {
    expect(SEARCH_DESCRIPTION.length).toBeGreaterThan(50);
  });

  it("SEARCH_BODY_STATIC is non-empty", () => {
    expect(SEARCH_BODY_STATIC.length).toBeGreaterThan(100);
  });

  it("REMAINING_TOOLS is non-empty", () => {
    expect(REMAINING_TOOLS.length).toBeGreaterThan(500);
  });

  // ─── SSH error handling ────────────────────────────────────────

  it("ssh() reads stderr alongside stdout", () => {
    expect(rendered).toContain("Promise.all");
    expect(rendered).toContain("errText");
  });

  it("ssh() checks for SSH connection failure (exit 255)", () => {
    expect(rendered).toContain("exitCode === 255");
    expect(rendered).toContain("SSH connection failed");
  });

  it("ssh() surfaces errors when exit non-zero + empty stdout + stderr", () => {
    expect(rendered).toContain("exitCode !== 0 && !text.trim() && errText.trim()");
  });

  // ─── Search result count ──────────────────────────────────────

  it("search tool reports total result count when truncated", () => {
    expect(SEARCH_BODY_STATIC).toContain("wc -l");
    expect(SEARCH_BODY_STATIC).toContain("showing");
  });

  // ─── Grep total match count ───────────────────────────────────

  it("grep tool counts total matches in parallel", () => {
    expect(REMAINING_TOOLS).toContain("rg -ic");
    expect(REMAINING_TOOLS).toContain("countResult");
  });

  it("grep tool shows count note when results are truncated", () => {
    expect(REMAINING_TOOLS).toContain("countNote");
    expect(REMAINING_TOOLS).toContain("showing");
  });

  // ─── No unresolved placeholders ───────────────────────────────

  it("has no unresolved {{...}} placeholders after render", () => {
    expect(rendered).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

// ─── safePath behaviour ──────────────────────────────────────────────
// safePath lives as a string inside STATIC_BODY; extract and eval it
// so we can assert runtime behaviour (not just textual presence).

describe("safePath (extracted from STATIC_BODY)", () => {
  // Extract the function source from the template and compile it.
  // The template uses TypeScript `: string` annotations — strip them
  // to get plain JS that `new Function` can parse.
  function extractSafePath(): (p: string) => string {
    const match = STATIC_BODY.match(/function safePath\(p: string\): string \{([\s\S]*?)\n\}/);
    if (!match) throw new Error("safePath not found in STATIC_BODY");
    // Strip TypeScript type annotations (`: string`, `: number`, etc.)
    const body = match[1].replace(/:\s*string\b/g, "").replace(/:\s*number\b/g, "");
    return new Function("p", body) as (p: string) => string;
  }

  const safePath = extractSafePath();

  it("preserves .. inside filenames (MDN do...while pattern)", () => {
    expect(safePath("/docs/mdn/web/javascript/reference/statements/do...while/index.md"))
      .toBe("/docs/mdn/web/javascript/reference/statements/do...while/index.md");
  });

  it("preserves .. inside filenames (if...else, try...catch, for...of)", () => {
    const cases = [
      "/docs/mdn/web/javascript/reference/statements/if...else/index.md",
      "/docs/mdn/web/javascript/reference/statements/try...catch/index.md",
      "/docs/mdn/web/javascript/reference/statements/for...of/index.md",
      "/docs/mdn/web/javascript/reference/statements/for-await...of/index.md",
      "/docs/mdn/web/javascript/reference/statements/for...in/index.md",
      "/docs/mdn/webassembly/reference/control_flow/if...else/index.md",
    ];
    for (const p of cases) {
      expect(safePath(p), p).toBe(p);
    }
  });

  it("strips ../ traversal attempts", () => {
    expect(safePath("/docs/../etc/passwd")).toBe("/docs/etc/passwd");
    expect(safePath("../../../etc/passwd")).toBe("/docs/etc/passwd");
  });

  it("prepends /docs/ when missing", () => {
    expect(safePath("supabase/guide.md")).toBe("/docs/supabase/guide.md");
  });

  it("preserves well-formed /docs/ paths unchanged", () => {
    expect(safePath("/docs/supabase/guide.md")).toBe("/docs/supabase/guide.md");
  });

  it("collapses redundant slashes", () => {
    expect(safePath("/docs//supabase//guide.md")).toBe("/docs/supabase/guide.md");
  });
});
