import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { convertRstTree, type ConvertedFile } from "../../../src/ingestors/rst-converter.js";

// The converter shells out to python3 + docutils; skip where absent.
const hasDocutils = (() => {
  try {
    execFileSync("python3", ["-c", "import docutils"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let byPath: Record<string, string>;

beforeAll(async () => {
  if (!hasDocutils) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rst-test-"));

  // ── index.rst - document title, headings, inline markup ──────────
  fs.writeFileSync(
    path.join(root, "index.rst"),
    [
      "#################",
      " Getting Started ",
      "#################",
      "",
      "This is a **strong** and *emphasised* paragraph with ``literal`` text.",
      "",
      ".. note::",
      "",
      "   This is a note directive - rendered natively by docutils.",
      "",
      ".. warning::",
      "",
      "   Don't do this.",
      "",
      ".. toctree::",
      "   :maxdepth: 2",
      "",
      "   installation",
      "   grid-table",
      "",
      "Section One",
      "===========",
      "",
      "Content under section one with a :term:`glossary term` and :class:`MyClass`.",
      "",
      "Another Section",
      "---------------",
      "",
      "A :func:`some_function` reference and :meth:`~MyClass.method_name`.",
      "",
      "Sub-Sub Section",
      "~~~~~~~~~~~~~~~",
      "",
      "Deep nesting. See :doc:`installation` for setup and :doc:`api/index`.",
      "",
    ].join("\n"),
  );

  // ── installation.rst - setext H1, simple table, code block ──────
  fs.writeFileSync(
    path.join(root, "installation.rst"),
    [
      "Installation",
      "============",
      "",
      "Install with pip::",
      "",
      "    pip install package-name",
      "",
      ".. code-block:: python",
      "",
      "   def hello():",
      "       print(\"Hello\")",
      "",
      "Simple Table",
      "------------",
      "",
      "=====  =====  ======",
      "A      B      A and B",
      "=====  =====  ======",
      "False  False  False",
      "True   False  False",
      "False  True   False",
      "True   True   True",
      "=====  =====  ======",
      "",
    ].join("\n"),
  );

  // ── grid-table.rst - simple grid table (no merged cells), bullet lists
  fs.writeFileSync(
    path.join(root, "grid-table.rst"),
    [
      "Grid Table Example",
      "==================",
      "",
      "+------------+------------+-----------+",
      "| Header 1   | Header 2   | Header 3  |",
      "+============+============+===========+",
      "| cell 1a    | cell 1b    | cell 1c   |",
      "+------------+------------+-----------+",
      "| cell 2a    | cell 2b    | cell 2c   |",
      "+------------+------------+-----------+",
      "",
      "Bullets and Enumerated",
      "----------------------",
      "",
      "* Bullet one",
      "* Bullet two",
      "  * Nested bullet",
      "* Bullet three with ``code`` and *emphasis*.",
      "",
      "#. First item",
      "#. Second item",
      "#. Third item",
      "",
    ].join("\n"),
  );

  // ── api/index.rst - file with explicit :doc: cross-refs ─────────
  fs.mkdirSync(path.join(root, "api"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api", "index.rst"),
    [
      "API Reference",
      "=============",
      "",
      "Detailed docs at :doc:`/installation` and :doc:`/grid-table`.",
      "",
    ].join("\n"),
  );

  const files: ConvertedFile[] = await convertRstTree(root);
  byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
});

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasDocutils)("rst-converter", () => {
  it("converts all .rst files", () => {
    expect(Object.keys(byPath).sort()).toEqual([
      "api/index.md",
      "grid-table.md",
      "index.md",
      "installation.md",
    ]);
  });

  it("extracts H1 from document title adornments", () => {
    expect(byPath["index.md"]).toMatch(/^# Getting Started/);
    expect(byPath["installation.md"]).toMatch(/^# Installation/);
    expect(byPath["grid-table.md"]).toMatch(/^# Grid Table Example/);
    expect(byPath["api/index.md"]).toMatch(/^# API Reference/);
  });

  it("preserves section heading hierarchy", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("## Section One");
    // note/warning admonitions push "Another Section" deeper
    expect(idx).toMatch(/^### Another Section$/m);
    expect(idx).toMatch(/^#### Sub-Sub Section$/m);
  });

  it("converts inline markup", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("**strong**");
    // Turndown outputs _emphasised_ not *emphasised*
    expect(idx).toMatch(/\b_emphasised_\b/);
    // docutils renders ``literal`` as <tt> - Turndown leaves as plain text
    expect(idx).toContain("literal text");
  });

  it("renders docutils note/warning admonitions", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("Note");
    expect(idx).toContain("rendered natively by docutils");
    expect(idx).toContain("Warning");
    expect(idx).toContain("Don't do this");
  });

  it("renders code blocks and literal blocks", () => {
    const inst = byPath["installation.md"];
    expect(inst).toContain("```");
    expect(inst).toContain("pip install package-name");
    expect(inst).toContain("def hello():");
    expect(inst).toContain('print("Hello")');
  });

  it("converts simple tables", () => {
    const inst = byPath["installation.md"];
    expect(inst).toContain("|"); // GFM table bars
    expect(inst).toContain("False");
    expect(inst).toContain("True");
    expect(inst).toContain("A and B");
  });

  it("converts grid tables", () => {
    const grid = byPath["grid-table.md"];
    expect(grid).toContain("Header 1");
    expect(grid).toContain("Header 2");
    expect(grid).toContain("cell 1a");
    expect(grid).toContain("|"); // table markup
  });

  it("converts bullet and enumerated lists", () => {
    const grid = byPath["grid-table.md"];
    expect(grid).toContain("Bullet one");
    expect(grid).toContain("Nested bullet");
    expect(grid).toContain("First item");
    expect(grid).toContain("Second item");
  });

  it("stubs Sphinx-only roles (:term:, :class:, :func:, :meth:)", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("[term: `glossary term`]");
    expect(idx).toContain("[class: `MyClass`]");
    expect(idx).toContain("[func: `some_function`]");
    expect(idx).toContain("[meth: `~MyClass.method_name`]");
  });

  it("rewrites :doc: references to .md links", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("[installation](installation.md)");
    expect(idx).toContain("[api/index](api/index.md)");

    const api = byPath["api/index.md"];
    expect(api).toContain("[installation](installation.md)");
    expect(api).toContain("[grid-table](grid-table.md)");
  });

  it("stubs toctree directive with content", () => {
    const idx = byPath["index.md"];
    expect(idx).toContain("[directive: toctree]");
    expect(idx).toContain("installation");
    expect(idx).toContain("grid-table");
  });
});