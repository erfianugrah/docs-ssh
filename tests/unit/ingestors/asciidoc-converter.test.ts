import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { convertAsciiDocTree, type ConvertedFile } from "../../../src/ingestors/asciidoc-converter.js";

/**
 * Builds a minimal Antora component on disk:
 *   <root>/antora.yml
 *   <root>/modules/ROOT/pages/index.adoc
 *   <root>/modules/ROOT/pages/connectors/sample.adoc
 *   <root>/modules/ROOT/partials/shared.adoc
 */
let root: string;
let byPath: Record<string, string>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "adoc-test-"));
  const pages = path.join(root, "modules", "ROOT", "pages");
  const partials = path.join(root, "modules", "ROOT", "partials");
  fs.mkdirSync(path.join(pages, "connectors"), { recursive: true });
  fs.mkdirSync(partials, { recursive: true });

  fs.writeFileSync(
    path.join(root, "antora.yml"),
    [
      "name: test",
      "version: ~",
      "asciidoc:",
      "  attributes:",
      "    debezium-version: 9.9.9",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(partials, "shared.adoc"),
    // References a page-level attribute the including page defines.
    "The {connector-name} connector reads the log. Version {debezium-version}.\n",
  );

  fs.writeFileSync(
    path.join(pages, "index.adoc"),
    [
      "= Getting Started",
      "",
      "Install {prodname} first.",
      "",
      "See xref:connectors/sample.adoc#config[the sample connector].",
      "",
      "ifdef::community[]",
      "Community-only note.",
      "endif::community[]",
      "ifdef::product[]",
      "Product-only note.",
      "endif::product[]",
      "",
    ].join("\n"),
  );

  fs.writeFileSync(
    path.join(pages, "connectors", "sample.adoc"),
    [
      "= {prodname} connector for Sample",
      ":context: sample",
      ":connector-name: Sample",
      "",
      "include::{partialsdir}/shared.adoc[]",
      "",
      "[#config]",
      "== Configuration",
      "",
      "A missing build snippet follows:",
      "include::{snippetsdir}/generated.adoc[]",
      "",
    ].join("\n"),
  );

  const files: ConvertedFile[] = await convertAsciiDocTree(root);
  byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("convertAsciiDocTree", () => {
  it("emits one .md per page, paths relative to pages/", () => {
    expect(Object.keys(byPath).sort()).toEqual(["connectors/sample.md", "index.md"]);
  });

  it("prepends the document title as an H1 (dropped by standalone:false)", () => {
    expect(byPath["index.md"]).toMatch(/^# Getting Started/);
    expect(byPath["connectors/sample.md"]).toMatch(/^# Debezium connector for Sample/);
  });

  it("resolves {prodname} from the injected attribute map", () => {
    expect(byPath["index.md"]).toContain("Install Debezium first.");
    expect(byPath["index.md"]).not.toContain("{prodname}");
  });

  it("resolves include:: partials and page-level attributes inside them", () => {
    // {connector-name} is defined in the page header but used in the
    // shared partial — the per-page attribute merge must make it resolve.
    expect(byPath["connectors/sample.md"]).toContain("The Sample connector reads the log.");
    expect(byPath["connectors/sample.md"]).toContain("Version 9.9.9.");
    expect(byPath["connectors/sample.md"]).not.toContain("{connector-name}");
  });

  it("renders the community variant of ifdef and drops product-only blocks", () => {
    expect(byPath["index.md"]).toContain("Community-only note.");
    expect(byPath["index.md"]).not.toContain("Product-only note.");
  });

  it("rewrites xref .html targets to .md", () => {
    expect(byPath["index.md"]).toContain("(connectors/sample.md#config)");
    expect(byPath["index.md"]).not.toContain(".html");
  });

  it("strips Unresolved directive placeholders for build-generated snippets", () => {
    expect(byPath["connectors/sample.md"]).not.toContain("Unresolved directive");
    expect(byPath["connectors/sample.md"]).not.toContain("{snippetsdir}");
  });
});
