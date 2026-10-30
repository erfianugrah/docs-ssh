/**
 * docs_related (docs-ssh#5 phase 2): embedding neighbours of a page, read
 * from /docs/_related.tsv and titled from /docs/_index.tsv.
 *
 * _related.tsv is written by embed/embed.py: one line per page,
 * "<path>\t<n1>\t<n2>...", neighbours most similar first, sorted by path.
 * Output mirrors docs_links: a [source] header, then "related (N):" (or
 * "related (N, showing C):" when capped at maxResults, default 8) and one
 * "/docs/<path>[\t<title>]" line per neighbour, in file order.
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
  root = mkdtempSync(join(tmpdir(), "docs-related-"));
  for (const dir of ["postgres", "supabase/guides"]) mkdirSync(join(root, dir), { recursive: true });
  for (const f of ["postgres/sql-select.md", "postgres/sql-insert.md", "supabase/guides/db.md"]) {
    writeFileSync(join(root, f), "# x\n");
  }
  writeFileSync(
    join(root, "_index.tsv"),
    "postgres/sql-select.md\tSELECT\tretrieve rows\n" +
      "postgres/sql-insert.md\tINSERT\tcreate rows\n" +
      "supabase/guides/db.md\tDatabase\tPostgres in Supabase\n",
  );
  const many = Array.from({ length: 12 }, (_, i) => `many/p${String(i).padStart(2, "0")}.md`);
  writeFileSync(
    join(root, "_related.tsv"),
    [
      ["many/hub.md", ...many],
      ["postgres/sql-insert.md", "postgres/sql-select.md"],
      // neighbours in similarity order, not alphabetical; one untitled
      ["postgres/sql-select.md", "supabase/guides/db.md", "postgres/sql-insert.md", "postgres/untitled.md"],
      // a path that CONTAINS postgres/sql-select.md must not match
      ["xpostgres/sql-select.md", "postgres/sql-insert.md"],
    ]
      .map((r) => r.join("\t") + "\n")
      .join(""),
  );
  svc = new DocsService(root);

  bare = mkdtempSync(join(tmpdir(), "docs-norelated-"));
  mkdirSync(join(bare, "postgres"), { recursive: true });
  writeFileSync(join(bare, "postgres/sql-select.md"), "# x\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

d("DocsService.related", () => {
  it("lists neighbours in file order with titles, exact path match only", async () => {
    const out = await svc.related({ path: "/docs/postgres/sql-select.md" });
    expect(out).toBe(
      [
        "[source] /docs/postgres/sql-select.md",
        "",
        "related (3):",
        "/docs/supabase/guides/db.md\tDatabase",
        "/docs/postgres/sql-insert.md\tINSERT",
        "/docs/postgres/untitled.md",
      ].join("\n"),
    );
  });

  it("accepts the bare corpus path and the filePath alias", async () => {
    expect(await svc.related({ path: "postgres/sql-insert.md" })).toContain("related (1):");
    expect(await svc.related({ filePath: "/docs/postgres/sql-insert.md" })).toContain(
      "/docs/postgres/sql-select.md\tSELECT",
    );
  });

  it("caps at maxResults (default 8) and says so", async () => {
    const out = await svc.related({ path: "/docs/many/hub.md" });
    expect(out).toContain("related (12, showing 8):");
    expect(out.split("\n").filter((l) => l.startsWith("/docs/")).length).toBe(8);
    expect(out).toContain("/docs/many/p00.md");
    expect(out).not.toContain("/docs/many/p08.md");
    const three = await svc.related({ path: "/docs/many/hub.md", maxResults: 3 });
    expect(three).toContain("related (12, showing 3):");
  });

  it("reports when the page has no recorded neighbours", async () => {
    expect(await svc.related({ path: "/docs/supabase/guides/db.md" })).toBe(
      "[no related pages recorded for /docs/supabase/guides/db.md]",
    );
  });

  it("errors clearly when _related.tsv is not deployed", async () => {
    expect(await new DocsService(bare).related({ path: "/docs/postgres/sql-select.md" })).toBe(
      "[error] related pages not available on this server (/docs/_related.tsv missing)",
    );
  });

  it("does not escape the docs root", async () => {
    expect(await svc.related({ path: "../../../../etc/passwd" })).not.toContain("root:");
  });
});
