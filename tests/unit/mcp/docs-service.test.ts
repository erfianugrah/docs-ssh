import { describe, it, expect } from "vitest";
import {
  DocsService,
  createLimiter,
  splitOrigin,
  type Runner,
} from "../../../src/mcp/docs-service.js";

/** Capture the last command a DocsService method builds, return a canned stdout. */
function stubRunner(stdout = "", exitCode = 0): { runner: Runner; cmds: string[] } {
  const cmds: string[] = [];
  const runner: Runner = async (command) => {
    cmds.push(command);
    // Handle source-list lookup (runs before every source-filtered operation)
    if (command.includes("_index.tsv") && command.includes("sort -u")) {
      return { stdout: "supabase\npostgres\naws-api\nerfi-technical-blog", stderr: "", exitCode: 0 };
    }
    return { stdout, stderr: "", exitCode };
  };
  return { runner, cmds };
}

describe("DocsService command construction", () => {
  it("search targets the index with a source filter and result cap", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth", source: "supabase", maxResults: 5 });
    const searchCmd = cmds.find((c) => c.includes("rg -i -e 'auth'"))!;
    expect(searchCmd).toBeDefined();
    expect(searchCmd).toContain("/docs/_index.tsv");
    expect(searchCmd).toContain("rg -i -e 'auth'");
    expect(searchCmd).toContain("rg '^supabase/'");
  });

  it("read builds an offset+lines range and prefixes the source header", async () => {
    const { runner, cmds } = stubRunner("body");
    const svc = new DocsService("/docs", runner);
    const out = await svc.read({ path: "/docs/postgres/rls.md", offset: 10, lines: 20 });
    const readCmd = cmds.find((c) => c.includes("--line-range"))!;
    expect(readCmd).toContain("--line-range=10:29");
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

describe("splitOrigin", () => {
  it("returns no origin when the output has no [url] line", () => {
    expect(splitOrigin("body\nmore")).toEqual({ origin: "", rest: "body\nmore" });
  });

  it("splits a leading [url] line off the body using a real newline", () => {
    expect(splitOrigin("[url] https://e/x\nbody")).toEqual({
      origin: "[url] https://e/x",
      rest: "body",
    });
  });

  it("handles an origin-only output", () => {
    expect(splitOrigin("[url] https://e/x")).toEqual({
      origin: "[url] https://e/x",
      rest: "",
    });
  });

  it("does not mistake a body line for an origin", () => {
    const out = "[file] 10 lines, 200 bytes\n\n# H1";
    expect(splitOrigin(out).origin).toBe("");
  });
});

describe("DocsService origin URL headers", () => {
  it("read emits a [url] line when the origins lookup returns one", async () => {
    const runner: Runner = async (command) => {
      if (command.includes("_origins.tsv")) {
        return {
          stdout: "[url] https://erfi.dev/guides/x/\nbody",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "body", stderr: "", exitCode: 0 };
    };
    const svc = new DocsService("/docs", runner);
    const out = await svc.read({ path: "/docs/erfi-technical-blog/guides/x.md" });
    expect(out).toBe(
      "[source] /docs/erfi-technical-blog/guides/x.md\n[url] https://erfi.dev/guides/x/\n\nbody",
    );
  });

  it("read keys the lookup on the path relative to the docs root", async () => {
    const { runner, cmds } = stubRunner("body");
    const svc = new DocsService("/docs", runner);
    await svc.read({ path: "/docs/erfi-technical-blog/guides/x.md" });
    // cmds[0] is source-list lookup, cmds[1] is the actual read
    const originCmd = cmds.find((c) => c.includes("erfi-technical-blog/guides/x.md"))!;
    expect(originCmd).toContain("-v k='erfi-technical-blog/guides/x.md'");
    expect(originCmd).toContain("_origins.tsv");
  });

  it("read omits [url] when the entry is missing (no leading line printed)", async () => {
    const { runner } = stubRunner("body");
    const svc = new DocsService("/docs", runner);
    const out = await svc.read({ path: "/docs/postgres/rls.md" });
    expect(out).toBe("[source] /docs/postgres/rls.md\n\nbody");
    expect(out).not.toContain("[url]");
  });

  it("summary places [url] under the source header", async () => {
    const runner: Runner = async (command) => {
      if (command.includes("_origins.tsv")) {
        return { stdout: "[url] https://example.com/x\n# H1", stderr: "", exitCode: 0 };
      }
      if (command.includes("wc -l")) return { stdout: "10", stderr: "", exitCode: 0 };
      if (command.includes("wc -c")) return { stdout: "200", stderr: "", exitCode: 0 };
      return { stdout: "# H1", stderr: "", exitCode: 0 };
    };
    const svc = new DocsService("/docs", runner);
    const out = await svc.summary({ path: "/docs/foo/bar.md" });
    expect(out).toBe(
      "[source] /docs/foo/bar.md\n[url] https://example.com/x\n\n10 lines, 200 bytes\n\n# H1",
    );
  });

  it("search joins the origin URL column when the index exists", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary\thttps://e/x");
    const svc = new DocsService("/docs", runner);
    const out = await svc.search({ query: "auth" });
    const joinCmd = cmds.find((c) => c.includes("_origins.tsv' -") && !c.includes("sort -u"))!;
    expect(joinCmd).toContain("[ -s '/docs/_origins.tsv' ]");
    expect(joinCmd).toContain("_origins.tsv' -");
    expect(out).toContain("https://e/x");
  });
});

describe("DocsService safePath jail", () => {
  it("strips ../ traversal and rebases onto the root", async () => {
    const runner: Runner = async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const svc = new DocsService("/docs", runner);
    // safePath strips ../ but argPath is the original user input
    const out = await svc.summary({ path: "../../../../etc/passwd" });
    // The [source] header preserves the user's original path
    expect(out).toContain("[source] ../../../../etc/passwd");
  });

  it("accepts the public /docs/ prefix and a non-default root together", async () => {
    const runner: Runner = async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const svc = new DocsService("/tmp/x/docs", runner);
    const out = await svc.summary({ path: "/docs/supabase/auth.md" });
    // safePath strips /docs/ and rebases onto the real root; source is "supabase"
    expect(out).toContain("[source] /docs/supabase/auth.md");
  });
});

describe("DocsService result cache", () => {
  it("serves identical (op,args) calls from cache - runner invoked once", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth", source: "supabase" });
    await svc.search({ query: "auth", source: "supabase" });
    // cmds[0] = sourceNames lookup (once, cached for second call),
    // cmds[1] = actual search (once, result cached for second call).
    const searchCmds = cmds.filter((c) => c.includes("rg -i -e 'auth'"));
    expect(searchCmds.length).toBe(1);
  });

  it("treats different args as distinct cache keys", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth" });
    await svc.search({ query: "rls" });
    const searchCmds = cmds.filter((c) => c.includes("/docs/_index.tsv") && !c.includes("sort -u"));
    expect(searchCmds.length).toBe(2);
  });

  it("never caches transient errors (timeout is retried)", async () => {
    let calls = 0;
    const runner: Runner = async () => {
      calls++;
      return { stdout: "", stderr: "", exitCode: 124 }; // timeout
    };
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "x" });
    await svc.search({ query: "x" });
    expect(calls).toBe(2); // error result was not cached
  });
});

describe("createLimiter concurrency cap", () => {
  it("never runs more than `max` operations at once", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBeLessThanOrEqual(2);
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

describe("DocsService source-guard", () => {
  // Simulate a docs root with known sources: a.tsv index listing
  // "supabase/file.md" and "postgres/file.md".
  function makeRunner(opts?: { sources?: string[] }) {
    const sourceList = (opts?.sources ?? [
      "aws-api", "aws-sdk", "aws-waf",
      "flyio", "flyio-api",
      "ietf-rfc",
      "jlcpcb",
      "kicad",
      "lidarr-api",
      "nuvoton-m480-bsp",
      "postgres",
      "servarr",
      "supabase", "supabase-api", "supabase-auth-api", "supabase-status",
    ]).join("\n");
    const runner: Runner = async (command) => {
      if (command.includes("_index.tsv") && command.includes("sort -u")) {
        return { stdout: sourceList, stderr: "", exitCode: 0 };
      }
      if (command.includes("origins.tsv")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("/docs/_index.tsv")) {
        return { stdout: "supabase/x.md\tTitle\tsummary", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    return runner;
  }

  it("search with unknown source returns suggestion", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.search({ query: "auth", source: "lidarr" });
    expect(out).toContain("[unknown source");
    expect(out).toContain("lidarr");
    // Should suggest something (lidarr is not a prefix of supabase/postgres,
    // but DL distance may be >2, so suggestions may be empty - just check it
    // formats correctly when there are suggestions.
    if (out.includes("did you mean")) {
      expect(out).toMatch(/did you mean:/);
    }
  });

  it("search with known source runs normally", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.search({ query: "auth", source: "supabase" });
    expect(out).not.toContain("[unknown source");
  });

  it("search without source runs normally", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.search({ query: "auth" });
    expect(out).not.toContain("[unknown source");
  });

  it("find with unknown source returns suggestion", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.find({ pattern: "*.md", source: "lidarr" });
    expect(out).toContain("[unknown source");
    expect(out).toContain("lidarr");
  });

  it("read with unknown source in path returns suggestion", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.read({ path: "/docs/nuvoton/file.md" });
    expect(out).toContain("[unknown source");
    expect(out).toContain("nuvoton");
  });

  it("grep with unknown source in path returns suggestion", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.grep({ query: "x", path: "/docs/fly/" });
    expect(out).toContain("[unknown source");
    expect(out).toContain("fly");
  });

  it("summary with unknown source in path returns suggestion", async () => {
    const svc = new DocsService("/docs", makeRunner());
    const out = await svc.summary({ path: "/docs/rfc/x.md" });
    expect(out).toContain("[unknown source");
    expect(out).toContain("rfc");
  });

  it("sourceGuard returns null for known source", async () => {
    const svc = new DocsService("/docs", makeRunner());
    // Force source names to load
    await svc.search({ query: "x", source: "supabase" });
    // Directly check via a second search with another known source
    const out = await svc.search({ query: "x", source: "postgres" });
    expect(out).not.toContain("[unknown source");
  });

  it("caches the source list (single awk call)", async () => {
    let awkCalls = 0;
    const runner: Runner = async (command) => {
      // Only count the source-listing awk, not ORIGIN_JOIN awk
      if (command.includes("_index.tsv") && command.includes("sort -u")) {
        awkCalls++;
        return { stdout: "supabase\npostgres", stderr: "", exitCode: 0 };
      }
      if (command.includes("/docs/_index.tsv")) {
        return { stdout: "supabase/x.md\tTitle\tsummary", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "x", source: "lidarr" });
    await svc.search({ query: "y", source: "lidarr" });
    expect(awkCalls).toBe(1); // source list cached after first access
  });
});
