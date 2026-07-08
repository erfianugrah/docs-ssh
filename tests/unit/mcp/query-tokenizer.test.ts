import { describe, it, expect } from "vitest";
import {
  tokenizeQuery,
  rgAndChain,
  rgFilesAndChain,
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

describe("rgAndChain", () => {
  it("first rg reads the file, the rest filter stdin", () => {
    expect(rgAndChain(["a", "b", "c"], "/docs/_index.tsv")).toBe(
      "rg -i 'a' /docs/_index.tsv | rg -i 'b' | rg -i 'c'",
    );
  });

  it("single token reads the file directly with no pipe", () => {
    expect(rgAndChain(["auth"], "/docs/_index.tsv")).toBe(
      "rg -i 'auth' /docs/_index.tsv",
    );
  });

  it("shell-quotes single quotes in a token", () => {
    expect(rgAndChain(["it's"], "/f")).toBe("rg -i 'it'\\''s' /f");
  });
});

describe("rgFilesAndChain", () => {
  it("single token is a plain rg -il", () => {
    expect(rgFilesAndChain(["a"], "/docs/x/")).toBe(
      "rg -il 'a' '/docs/x/' 2>/dev/null",
    );
  });

  it("multi token NUL-chains through xargs so every token must match", () => {
    expect(rgFilesAndChain(["a", "b", "c"], "/docs/x/")).toBe(
      "rg --null -il 'a' '/docs/x/' 2>/dev/null | " +
        "xargs -0 -r rg --null -il 'b' 2>/dev/null | " +
        "xargs -0 -r rg -il 'c' 2>/dev/null",
    );
  });
});

describe("DocsService.search multi-word wiring", () => {
  it("ANDs tokens in the index pass", async () => {
    const { runner, cmds } = stubRunner("supabase-etl/x.md\tTitle\tsummary");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "etl pipeline replication", source: "supabase-etl" });
    expect(cmds[0]).toContain(
      "rg -i 'etl' /docs/_index.tsv | rg -i 'pipeline' | rg -i 'replication'",
    );
    expect(cmds[0]).toContain("rg '^supabase-etl/'");
  });

  it("fallback ANDs tokens across filename (find -iname) and content", async () => {
    // index pass returns empty -> fallback fires (find + content in parallel)
    const { runner, cmds } = stubRunner("");
    const svc = new DocsService("/docs", runner);
    await svc.search({ query: "vector embeddings ai", source: "supabase" });
    const find = cmds.find((c) => c.startsWith("find "))!;
    const content = cmds.find((c) => c.includes("xargs -0"))!;
    expect(find).toContain("-iname '*vector*' -iname '*embeddings*' -iname '*ai*'");
    expect(content).toContain(
      "rg --null -il 'vector' '/docs/supabase/' 2>/dev/null | " +
        "xargs -0 -r rg --null -il 'embeddings' 2>/dev/null | " +
        "xargs -0 -r rg -il 'ai' 2>/dev/null",
    );
  });
});
