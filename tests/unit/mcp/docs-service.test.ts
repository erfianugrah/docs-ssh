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
    expect(cmds[0]).toContain("-v k='erfi-technical-blog/guides/x.md'");
    expect(cmds[0]).toContain("_origins.tsv");
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
    expect(cmds[0]).toContain("[ -s '/docs/_origins.tsv' ]");
    expect(cmds[0]).toContain("_origins.tsv' -");
    expect(out).toContain("https://e/x");
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

describe("DocsService result cache", () => {
  it("serves identical (op,args) calls from cache - runner invoked once", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth", source: "supabase" });
    await svc.search({ query: "auth", source: "supabase" });
    expect(cmds.length).toBe(1); // second call hit the cache
  });

  it("treats different args as distinct cache keys", async () => {
    const { runner, cmds } = stubRunner("supabase/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "auth" });
    await svc.search({ query: "rls" });
    expect(cmds.length).toBe(2);
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
