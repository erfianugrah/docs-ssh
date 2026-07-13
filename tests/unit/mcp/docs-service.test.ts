import { describe, it, expect } from "vitest";
import { DocsService, type Runner } from "../../../src/mcp/docs-service.js";

/** Capture the last command a DocsService method builds, return a canned stdout. */
function stubRunner(stdout = "", exitCode = 0): { runner: Runner; cmds: string[] } {
  const cmds: string[] = [];
  const runner: Runner = async (command) => {
    cmds.push(command);
    return { stdout, stderr: "", exitCode };
  };
  return { runner, cmds };
}

describe("DocsService command construction", () => {
  it("search targets the index with a source filter and result cap", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth", source: "supabase", maxResults: 5 });
    expect(cmds[0]).toContain("/docs/_index.tsv");
    expect(cmds[0]).toContain("rg -i -e 'auth'");
    expect(cmds[0]).toContain("rg '^supabase/'");
    // Truncation to maxResults now happens client-side (rankByTokenHits +
    // slice), not via a server-side `awk -v lim=` pipeline - single-token
    // queries return every matching row and JS slices to 5.
  });

  it("read builds an offset+lines range and prefixes the source header", async () => {
    const { runner, cmds } = stubRunner("body");
    const svc = new DocsService("/docs", runner);
    const out = await svc.read({ path: "/docs/postgres/rls.md", offset: 10, lines: 20 });
    expect(cmds[0]).toContain("--line-range=10:29");
    expect(out.startsWith("[source] /docs/postgres/rls.md")).toBe(true);
  });

  it("read accepts filePath as an alias for path", async () => {
    const { runner } = stubRunner("body");
    const svc = new DocsService("/docs", runner);
    const out = await svc.read({ filePath: "/docs/x.md" });
    expect(out).toContain("[source] /docs/x.md");
  });

  it("read throws when neither path nor filePath is given", async () => {
    const { runner } = stubRunner("");
    const svc = new DocsService("/docs", runner);
    await expect(svc.read({})).rejects.toThrow(/path.*required/i);
  });

  it("sources cd's into root so the awk field is stable", async () => {
    const { runner, cmds } = stubRunner("supabase: 3 files");
    const svc = new DocsService("/docs", runner);
    await svc.sources({});
    expect(cmds[0]).toContain("cd '/docs'");
    expect(cmds[0]).toContain("awk -F/ '{c[$2]++}");
  });

  it("grep formats rg --json output with match bolding", async () => {
    const rgJson = JSON.stringify({
      type: "match",
      data: {
        path: { text: "/docs/postgres/rls.md" },
        line_number: 3,
        lines: { text: "CREATE POLICY controls\n" },
        submatches: [{ start: 7, end: 13 }],
      },
    });
    const runner: Runner = async (command) => {
      if (command.includes("--json")) return { stdout: rgJson, stderr: "", exitCode: 0 };
      return { stdout: "1", stderr: "", exitCode: 0 }; // count
    };
    const svc = new DocsService("/docs", runner);
    const out = await svc.grep({ query: "POLICY", path: "/docs/postgres/" });
    expect(out).toContain("1 matches");
    expect(out).toContain("CREATE **POLICY** controls");
  });
});

describe("DocsService safePath jail", () => {
  it("strips ../ traversal and rebases onto the root", async () => {
    const { runner, cmds } = stubRunner("");
    const svc = new DocsService("/docs", runner);
    await svc.summary({ path: "../../../../etc/passwd" });
    // Every command must operate strictly under /docs, never /etc.
    for (const c of cmds) {
      expect(c).toContain("/docs/etc/passwd");
      expect(c).not.toMatch(/'\/etc\/passwd'/);
    }
  });

  it("accepts the public /docs/ prefix and a non-default root together", async () => {
    const { runner, cmds } = stubRunner("");
    const svc = new DocsService("/tmp/x/docs", runner);
    await svc.summary({ path: "/docs/supabase/auth.md" });
    expect(cmds[0]).toContain("/tmp/x/docs/supabase/auth.md");
  });
});

describe("DocsService error mapping", () => {
  it("maps timeout exit codes to a helpful message", async () => {
    const runner: Runner = async () => ({ stdout: "", stderr: "", exitCode: 124 });
    const svc = new DocsService("/docs", runner);
    const out = await svc.search({ query: "x" });
    expect(out).toContain("[error] command timed out");
  });
});
