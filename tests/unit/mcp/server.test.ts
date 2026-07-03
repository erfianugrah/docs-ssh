import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../../src/mcp/server.js";
import type { DocsService } from "../../../src/mcp/docs-service.js";

/** A DocsService stub that echoes which method+args were called. */
const stubService = {
  search: async (a: unknown) => `search:${JSON.stringify(a)}`,
  read: async (a: unknown) => `read:${JSON.stringify(a)}`,
  grep: async (a: unknown) => `grep:${JSON.stringify(a)}`,
  find: async (a: unknown) => `find:${JSON.stringify(a)}`,
  summary: async (a: unknown) => `summary:${JSON.stringify(a)}`,
  sources: async (a: unknown) => `sources:${JSON.stringify(a)}`,
} as unknown as DocsService;

let client: Client;

beforeAll(async () => {
  const server = buildServer(stubService);
  client = new Client({ name: "test", version: "1.0.0" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterAll(async () => {
  await client.close();
});

function textOf(res: { content: unknown }): string {
  return (res.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? "")
    .join("");
}

describe("MCP server wiring", () => {
  it("exposes exactly the six docs tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "docs_find",
      "docs_grep",
      "docs_read",
      "docs_search",
      "docs_sources",
      "docs_summary",
    ]);
  });

  it("advertises input schemas for each tool", async () => {
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "docs_search");
    expect(search?.inputSchema.properties).toHaveProperty("query");
    expect(search?.inputSchema.properties).toHaveProperty("source");
  });

  it("routes tools/call to the service and wraps the result as text", async () => {
    const res = await client.callTool({
      name: "docs_search",
      arguments: { query: "auth", source: "supabase" },
    });
    expect(textOf(res)).toBe('search:{"query":"auth","source":"supabase"}');
  });

  it("routes each remaining tool to its service method", async () => {
    for (const [name, prefix, args] of [
      ["docs_read", "read", { path: "/docs/x.md" }],
      ["docs_grep", "grep", { query: "q", path: "/docs/" }],
      ["docs_find", "find", { pattern: "*.md" }],
      ["docs_summary", "summary", { path: "/docs/x.md" }],
      ["docs_sources", "sources", {}],
    ] as const) {
      const res = await client.callTool({ name, arguments: args });
      expect(textOf(res)).toBe(`${prefix}:${JSON.stringify(args)}`);
    }
  });

  it("returns an error result for an unknown tool", async () => {
    const res = await client.callTool({ name: "docs_nope", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res as { content: unknown })).toContain("not found");
  });
});
