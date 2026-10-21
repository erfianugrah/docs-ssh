/**
 * MCP tool calls land in the same JSONL query log as SSH commands
 * (type "mcp", op = tool name minus "docs_", whitelisted args), so the
 * eval set covers connector traffic too.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHttpServer } from "../../../src/mcp/server.js";
import type { DocsService } from "../../../src/mcp/docs-service.js";

const stubService = {
  search: async () => "stub-search",
  read: async () => "stub-read",
} as unknown as DocsService;

let server: Server;
let base: string;
let dir: string;
let logFile: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "docs-mcp-log-"));
  logFile = join(dir, "docs-ssh.jsonl");
  const allowedHosts = ["127.0.0.1"];
  server = createHttpServer({ service: stubService, staticDir: dir, allowedHosts, allowedOrigins: [], logFile });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  allowedHosts.push(`127.0.0.1:${port}`);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

async function rpc(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

// The line is appended after the response is sent (no added latency), so
// wait for it to land.
async function logLines(atLeast = 1): Promise<Array<Record<string, unknown>>> {
  for (let i = 0; i < 50; i++) {
    try {
      const ls = (await readFile(logFile, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      if (ls.length >= atLeast) return ls;
    } catch {
      // not written yet
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

describe("MCP query log", () => {
  it("logs tools/call with op, whitelisted args and the forwarded client IP", async () => {
    await rpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "docs_search", arguments: { query: "row level security", source: "postgres", junk: "x" } },
      },
      { "X-Forwarded-For": "203.0.113.7, 10.0.71.1" },
    );
    const [l] = await logLines();
    expect(l).toMatchObject({ type: "mcp", client: "203.0.113.7", op: "search", q: "row level security", source: "postgres" });
    expect(typeof l.ts).toBe("string");
    expect(l).not.toHaveProperty("junk");
  });

  it("maps path/filePath and ignores non-tool methods", async () => {
    await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "docs_read", arguments: { filePath: "/docs/pg/a.md" } } });
    const lines = await logLines(2);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ type: "mcp", op: "read", path: "/docs/pg/a.md" });
  });
});
