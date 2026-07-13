import { describe, it, expect } from "vitest";
import {
  tokenizeQuery,
  rgOrChain,
  rgFilesOrChain,
  rankByTokenHits,
  DocsService,
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

describe("tokenizeQuery", () => {
  it("splits a multi-word query into per-word tokens", () => {
    expect(tokenizeQuery("etl pipeline replication")).toEqual([
      "etl",
      "pipeline",
      "replication",
    ]);
  });

  it("collapses runs of whitespace", () => {
    expect(tokenizeQuery("  vector   embeddings\tai ")).toEqual([
      "vector",
      "embeddings",
      "ai",
    ]);
  });

  it("keeps a double-quoted span as a single phrase token", () => {
    expect(tokenizeQuery('"logical replication" slot')).toEqual([
      "logical replication",
      "slot",
    ]);
  });

  it("mixes quoted phrases and bare words in order", () => {
    expect(tokenizeQuery('row "level security" policy')).toEqual([
      "row",
      "level security",
      "policy",
    ]);
  });

  it("returns a single token for a single word", () => {
    expect(tokenizeQuery("auth")).toEqual(["auth"]);
  });

  it("falls back to the trimmed raw query when nothing tokenizes", () => {
    expect(tokenizeQuery("   ")).toEqual([""]);
    expect(tokenizeQuery('""')).toEqual(['""']);
  });
});

describe("rgOrChain", () => {
  it("builds one rg call with an -e per token (any may match)", () => {
    expect(rgOrChain(["a", "b", "c"], "/docs/_index.tsv")).toBe(
      "rg -i -e 'a' -e 'b' -e 'c' /docs/_index.tsv",
    );
  });

  it("single token", () => {
    expect(rgOrChain(["auth"], "/docs/_index.tsv")).toBe(
      "rg -i -e 'auth' /docs/_index.tsv",
    );
  });

  it("shell-quotes single quotes in a token", () => {
    expect(rgOrChain(["it's"], "/f")).toBe("rg -i -e 'it'\\''s' /f");
  });
});

describe("rgFilesOrChain", () => {
  it("single token is a plain rg -il", () => {
    expect(rgFilesOrChain(["a"], "/docs/x/")).toBe(
      "rg -il -e 'a' '/docs/x/' 2>/dev/null",
    );
  });

  it("multi token is one rg -il call with -e per token (any may match)", () => {
    expect(rgFilesOrChain(["a", "b", "c"], "/docs/x/")).toBe(
      "rg -il -e 'a' -e 'b' -e 'c' '/docs/x/' 2>/dev/null",
    );
  });
});

describe("rankByTokenHits", () => {
  it("passes lines through unchanged for a single token", () => {
    const lines = ["b line", "a line"];
    expect(rankByTokenHits(lines, ["line"])).toEqual(lines);
  });

  it("ranks lines hitting more distinct tokens first", () => {
    const lines = [
      "only password here",
      "password reset AND email verification",
      "unrelated line",
      "password reset only",
    ];
    const tokens = ["password", "reset", "email", "verification"];
    expect(rankByTokenHits(lines, tokens)).toEqual([
      "password reset AND email verification",
      "password reset only",
      "only password here",
      "unrelated line",
    ]);
  });

  it("is stable on ties (preserves original order)", () => {
    const lines = ["password one", "password two", "password three"];
    expect(rankByTokenHits(lines, ["password", "reset"])).toEqual(lines);
  });
});

describe("DocsService.search multi-word wiring", () => {
  it("ORs tokens in the index pass (any token may match)", async () => {
    const { runner, cmds } = stubRunner("supabase-etl/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "etl pipeline replication", source: "supabase-etl" });
    expect(cmds[0]).toContain("rg -i -e 'etl' -e 'pipeline' -e 'replication' /docs/_index.tsv");
    expect(cmds[0]).toContain("rg '^supabase-etl/'");
  });

  it("ranks multi-token-hit rows first and truncates with a footer", async () => {
    const { runner } = stubRunner(
      [
        "supabase/a.md\tOnly Auth\tsomething about auth only",
        "supabase/b.md\tAuth And Roles\tcovers auth and roles together",
        "supabase/c.md\tUnrelated\tunrelated content",
      ].join("\n"),
    );
    const svc = new DocsService("/docs", runner);
    const out = await svc.search({ query: "auth roles", maxResults: 2 });
    // "Auth And Roles" hits both tokens -> ranked first even though it's
    // the second raw line.
    expect(out.split("\n")[0]).toContain("Auth And Roles");
    expect(out).toContain("showing 2 of 3 results");
  });

  it("fallback ORs tokens across filename (find -iname -o) and content", async () => {
    // index pass returns empty -> fallback fires (find + content in parallel)
    const { runner, cmds } = stubRunner("");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "vector embeddings ai", source: "supabase" });
    const find = cmds.find((c) => c.startsWith("find "))!;
    const content = cmds.find((c) => c.includes("rg -il"))!;
    expect(find).toContain("-iname '*vector*' -o -iname '*embeddings*' -o -iname '*ai*'");
    expect(content).toContain("rg -il -e 'vector' -e 'embeddings' -e 'ai' '/docs/supabase/' 2>/dev/null");
  });
});
