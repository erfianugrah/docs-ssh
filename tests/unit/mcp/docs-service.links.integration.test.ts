/**
 * docs_links against real binaries: outgoing links and backlinks for a page,
 * read from /docs/_links.tsv (built at fetch time by link-graph.ts) and
 * titled from /docs/_index.tsv. Skipped without rg/awk, like the sibling
 * integration test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocsService } from "../../../src/mcp/docs-service.js";

function has(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const d = has("rg") && has("awk") ? describe : describe.skip;

let root: string;
let bare: string;
let svc: DocsService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "docs-links-"));
  for (const dir of ["postgres", "supabase/guides"]) mkdirSync(join(root, dir), { recursive: true });
  for (const f of ["postgres/sql-select.md", "postgres/sql-insert.md", "postgres/sql-update.md", "supabase/guides/db.md"]) {
    writeFileSync(join(root, f), "# x\n");
  }
  writeFileSync(
    join(root, "_index.tsv"),
    "postgres/sql-select.md\tSELECT\tretrieve rows\n" +
      "postgres/sql-insert.md\tINSERT\tcreate rows\n" +
      "postgres/sql-update.md\tUPDATE\tupdate rows\n" +
      "supabase/guides/db.md\tDatabase\tPostgres in Supabase\n",
  );
  // Sorted by (from, to), as link-graph.ts writes it. Includes a path that
  // merely CONTAINS postgres/sql-select.md as a substring - must not match.
  const links: Array<[string, string]> = [
    ["postgres/sql-insert.md", "postgres/sql-select.md"],
    ["postgres/sql-select.md", "postgres/sql-insert.md"],
    ["postgres/sql-select.md", "postgres/sql-update.md"],
    ["postgres/sql-select.md", "postgres/untitled.md"],
    ["supabase/guides/db.md", "postgres/sql-select.md"],
    ["xpostgres/sql-select.md", "postgres/sql-update.md"],
  ];
  for (let i = 0; i < 60; i++) links.push([`many/p${String(i).padStart(2, "0")}.md`, "postgres/sql-update.md"]);
  links.sort((a, b) => (a[0] + "\t" + a[1] < b[0] + "\t" + b[1] ? -1 : 1));
  writeFileSync(join(root, "_links.tsv"), links.map(([a, b]) => `${a}\t${b}\n`).join(""));
  svc = new DocsService(root);

  bare = mkdtempSync(join(tmpdir(), "docs-nolinks-"));
  mkdirSync(join(bare, "postgres"), { recursive: true });
  writeFileSync(join(bare, "postgres/sql-select.md"), "# x\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

d("DocsService.links", () => {
  it("lists outgoing links then backlinks with titles, exact path match only", async () => {
    const out = await svc.links({ path: "/docs/postgres/sql-select.md" });
    expect(out).toBe(
      [
        "[source] /docs/postgres/sql-select.md",
        "",
        "outgoing (3):",
        "/docs/postgres/sql-insert.md\tINSERT",
        "/docs/postgres/sql-update.md\tUPDATE",
        "/docs/postgres/untitled.md",
        "",
        "backlinks (2):",
        "/docs/postgres/sql-insert.md\tINSERT",
        "/docs/supabase/guides/db.md\tDatabase",
      ].join("\n"),
    );
  });

  it("accepts the bare corpus path and filePath alias", async () => {
    const a = await svc.links({ path: "postgres/sql-select.md" });
    const b = await svc.links({ filePath: "/docs/postgres/sql-select.md" });
    expect(a).toContain("outgoing (3):");
    expect(b).toContain("backlinks (2):");
  });

  it("direction narrows to one list", async () => {
    const out = await svc.links({ path: "/docs/postgres/sql-select.md", direction: "out" });
    expect(out).toContain("outgoing (3):");
    expect(out).not.toContain("backlinks");
    const inn = await svc.links({ path: "/docs/postgres/sql-select.md", direction: "in" });
    expect(inn).toContain("backlinks (2):");
    expect(inn).not.toContain("outgoing");
  });

  it("caps each list at maxResults (default 50) and says so", async () => {
    const out = await svc.links({ path: "/docs/postgres/sql-update.md", direction: "in" });
    expect(out).toContain("backlinks (62, showing 50):");
    expect(out.split("\n").filter((l) => l.startsWith("/docs/")).length).toBe(50);
    const five = await svc.links({ path: "/docs/postgres/sql-update.md", direction: "in", maxResults: 5 });
    expect(five).toContain("backlinks (62, showing 5):");
    expect(five.split("\n").filter((l) => l.startsWith("/docs/")).length).toBe(5);
  });

  it("an empty list prints (0) and nothing else", async () => {
    const out = await svc.links({ path: "/docs/supabase/guides/db.md" });
    expect(out).toContain("outgoing (1):");
    expect(out).toContain("backlinks (0):");
  });

  it("reports when the page has no links at all", async () => {
    const out = await svc.links({ path: "/docs/postgres/nothing.md" });
    expect(out).toBe("[no links recorded for /docs/postgres/nothing.md]");
  });

  it("errors clearly when _links.tsv is not deployed", async () => {
    const out = await new DocsService(bare).links({ path: "/docs/postgres/sql-select.md" });
    expect(out).toBe("[error] link graph not available on this server (/docs/_links.tsv missing)");
  });

  it("does not escape the docs root", async () => {
    const out = await svc.links({ path: "../../../../etc/passwd" });
    expect(out).not.toContain("root:");
  });
});
