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

  it("ssh() surfaces timeout (exit 124) even when stderr is empty", () => {
    // DOCS_CMD_TIMEOUT kills commands with exit 124 and usually writes
    // no stderr. Without an explicit check the agent would see an empty
    // string and not know why the command returned nothing.
    expect(rendered).toContain("exitCode === 124");
    expect(rendered).toMatch(/timed out|timeout/i);
  });

  it("ssh() also handles exit 143 (timeout + SIGTERM passthrough)", () => {
    // When timeout(1) kills the child with SIGTERM, and the child exits
    // with 128+15=143, timeout propagates that code instead of 124.
    // Both codes must be treated as "killed by timeout".
    expect(rendered).toContain("exitCode === 143");
  });

  it("read tool handles offset without lines via open-ended range", () => {
    // If the agent passes { offset: 50 } without `lines`, the previous
    // implementation silently ignored offset and returned the full file.
    // bat supports open-ended ranges via "--line-range=N:" which reads
    // from N to end of file — preserve offset semantics.
    const readSection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const read"));
    const endIdx = readSection.indexOf("export const find");
    const readBody = readSection.slice(0, endIdx);
    // Open-ended range: "--line-range=${start}: " (space after colon).
    expect(readBody).toContain("--line-range=${start}: ");
    // sed fallback for open-ended range reads to end of file: "${start},$p"
    expect(readBody).toContain("${start},$p");
  });

  it("summary tool runs heading + line-count SSH calls in parallel", () => {
    // Two serial ssh() calls add a full round-trip latency for no reason.
    // Use Promise.all to dispatch both concurrently.
    const summarySection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const summary"));
    const endIdx = summarySection.indexOf("export const sources");
    const summaryBody = summarySection.slice(0, endIdx);
    expect(summaryBody).toContain("Promise.all");
  });

  it("formatRgMatches highlights match positions using submatches", () => {
    // parseRgJson captures ripgrep's submatches (byte positions of each
    // match within the line). Previously formatRgMatches ignored them,
    // forcing the agent to re-scan every line to find what actually
    // matched — burning tokens on verification greps.
    const formatterStart = STATIC_BODY.indexOf("function formatRgMatches");
    const formatterBody = STATIC_BODY.slice(formatterStart);
    // Formatter must actually consume submatches (not just the parser).
    expect(formatterBody).toContain("submatches");
    // And it must wrap matched substrings with ** markers for visual
    // confirmation of match position.
    expect(formatterBody).toContain('"**"');
  });

  it("capOutput hint uses the actual arg name 'lines' (not 'limit')", () => {
    // docs_read's arg is `lines`, not `limit`. The truncation hint
    // previously said "use docs_read with offset/limit" which sent
    // agents chasing a non-existent parameter.
    expect(STATIC_BODY).toContain("offset/lines");
    expect(STATIC_BODY).not.toContain("offset/limit");
  });

  it("read tool description references the actual arg names", () => {
    // Same mismatch: description said "offset/limit" but arg is `lines`.
    const readSection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const read"));
    const endIdx = readSection.indexOf("export const find");
    const readBody = readSection.slice(0, endIdx);
    expect(readBody).not.toMatch(/offset\/limit/);
  });

  it("read tool prepends a file-scale header so agents can triage", () => {
    // For token-efficient workflows, agents need to know file size BEFORE
    // reading to decide between full read vs docs_summary. A one-line
    // header ("📄 N lines, M KB") lets them route without re-reading.
    const readSection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const read"));
    const endIdx = readSection.indexOf("export const find");
    const readBody = readSection.slice(0, endIdx);
    // Guard: only prepend on full-file reads (no offset, no lines),
    // since offset/line reads are already explicit narrow slices.
    expect(readBody).toMatch(/lines,.*(KB|bytes)/);
  });

  it("sources tool uses a single find call (not N find-per-source)", () => {
    // Previously ran `find "$d" -type f | wc -l` inside a for loop over
    // every source dir — 139 subshells per invocation. A single find
    // + awk grouping collapses this to one pass.
    const srcSection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const sources"));
    const body = srcSection;
    // Should have awk for grouping and should NOT nest find inside a loop.
    expect(body).toContain("awk");
    // Detect the anti-pattern: a for-loop whose body runs find per iteration.
    expect(body).not.toMatch(/for d in \/docs\/\*\/.*find.*wc -l/s);
  });

  it("search tool runs the index pipeline exactly once", () => {
    // Previously ran rg twice: once piped to wc -l for a total count,
    // once piped to head -N for the result rows. Fold both into a single
    // awk pass that prints rows as they arrive and emits a trailing
    // "[showing X of Y]" when the truncation actually happened.
    const searchBody = SEARCH_BODY_STATIC;
    // Count occurrences of the literal pipeline construction — it's
    // built via `rg -i '${...}'` once; the previous double-run ran
    // `${pipeline}` twice inside a single shell command.
    const dollarPipelineCount = (searchBody.match(/\$\{pipeline\}/g) ?? []).length;
    expect(dollarPipelineCount).toBeLessThanOrEqual(1);
    // awk is used to count+truncate inline.
    expect(searchBody).toContain("awk");
  });

  it("grep tool emits a [no matches] message when query finds nothing", () => {
    // Empty rg output looks identical to a server timeout in the
    // current ssh() helper. Surface a clear "[no matches for ...]"
    // string so the agent doesn't keep grepping the same term.
    const grepSection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const grep"));
    const endIdx = grepSection.indexOf("export const summary");
    const grepBody = grepSection.slice(0, endIdx);
    expect(grepBody).toMatch(/no matches/i);
  });

  it("summary tool reports file size alongside line count", () => {
    // A bare line count tells the agent how big the file is in
    // lines but not in tokens. Add bytes so the agent can decide
    // whether a full read is affordable before calling docs_read.
    const summarySection = REMAINING_TOOLS.slice(REMAINING_TOOLS.indexOf("export const summary"));
    const endIdx = summarySection.indexOf("export const sources");
    const summaryBody = summarySection.slice(0, endIdx);
    expect(summaryBody).toContain("wc -c");
    expect(summaryBody).toMatch(/lines.*bytes|bytes.*lines/);
  });

  it("capOutput truncates at a safe boundary (no mid-surrogate slice)", () => {
    // String.prototype.slice operates on UTF-16 code units. If
    // MAX_RESULT_CHARS lands inside a surrogate pair, the result is an
    // orphan surrogate that may break JSON serialisation in the caller.
    // The helper must back off one code unit when the last char is a
    // high surrogate.
    expect(STATIC_BODY).toContain("charCodeAt");
    // The sentinel check for high-surrogate range is 0xD800..0xDBFF.
    expect(STATIC_BODY).toMatch(/0xD800|55296/);
  });

  // ─── Search result count ──────────────────────────────────────

  it("search tool reports total result count when truncated", () => {
    // Implementation no longer uses wc -l (folded into awk's END
    // block with the row printer). The truncation footer text is the
    // stable contract we check.
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
