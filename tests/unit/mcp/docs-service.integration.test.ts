/**
 * Real-binary integration test for DocsService: runs the actual
 * rg/bat/find/awk pipelines against a temp docs fixture. Skipped when
 * ripgrep is unavailable (e.g. a minimal CI runner) so it never fails
 * spuriously; the Docker E2E covers the with-binaries path regardless.
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

const hasBinaries = has("rg");
const d = hasBinaries ? describe : describe.skip;

let root: string;
let svc: DocsService;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "docs-mcp-"));
  mkdirSync(join(root, "supabase", "guides"), { recursive: true });
  mkdirSync(join(root, "postgres"), { recursive: true });
  writeFileSync(
    join(root, "supabase", "guides", "auth.md"),
    "# Authentication\n\nSupabase Auth uses JWT tokens.\n\n## Sessions\nUse getSession.\n",
  );
  writeFileSync(
    join(root, "postgres", "rls.md"),
    "# Row Level Security\n\nCREATE POLICY controls access.\n",
  );
  writeFileSync(
    join(root, "_index.tsv"),
    "supabase/guides/auth.md\tAuthentication\tSupabase Auth JWT sessions\n" +
      "postgres/rls.md\tRow Level Security\tCREATE POLICY access\n",
  );
  svc = new DocsService(root);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

d("DocsService against real binaries", () => {
  it("lists sources with file counts", async () => {
    const out = await svc.sources({});
    expect(out).toContain("supabase: 1 files");
    expect(out).toContain("postgres: 1 files");
  });

  it("searches the index", async () => {
    const out = await svc.search({ query: "JWT" });
    expect(out).toContain("supabase/guides/auth.md");
  });

  it("filters search by source", async () => {
    const out = await svc.search({ query: "POLICY", source: "postgres" });
    expect(out).toContain("postgres/rls.md");
    expect(out).not.toContain("supabase/");
  });

  it("reads a file with the source header", async () => {
    const out = await svc.read({ path: "/docs/postgres/rls.md" });
    expect(out).toContain("[source] /docs/postgres/rls.md");
    expect(out).toContain("CREATE POLICY controls access.");
  });

  it("reads a targeted line range", async () => {
    const out = await svc.read({ path: "supabase/guides/auth.md", offset: 3, lines: 1 });
    expect(out).toContain("Supabase Auth uses JWT tokens.");
    expect(out).not.toContain("## Sessions");
  });

  it("summarises headings", async () => {
    const out = await svc.summary({ path: "/docs/supabase/guides/auth.md" });
    expect(out).toContain("# Authentication");
    expect(out).toContain("## Sessions");
  });

  it("greps with match bolding", async () => {
    const out = await svc.grep({ query: "POLICY", path: "/docs/postgres/" });
    expect(out).toContain("**POLICY**");
  });

  it("finds files by glob", async () => {
    const out = await svc.find({ pattern: "*.md", source: "supabase" });
    expect(out).toContain("auth.md");
  });

  it("does not escape the docs root via path traversal", async () => {
    const out = await svc.read({ path: "../../../../etc/passwd" });
    expect(out).not.toContain("root:");
  });
});
