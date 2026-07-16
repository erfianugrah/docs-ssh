import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import { createHttpServer } from "../../../src/mcp/server.js";
import type { DocsService } from "../../../src/mcp/docs-service.js";

/** DocsService stub - HTTP tests only exercise the transport/routing layer. */
const stubService = {
  search: async () => "stub-search",
  read: async () => "stub-read",
  grep: async () => "stub-grep",
  find: async () => "stub-find",
  summary: async () => "stub-summary",
  sources: async () => "stub-sources",
} as unknown as DocsService;

let server: Server;
let base: string;
let staticDir: string;

beforeAll(async () => {
  staticDir = await mkdtemp(join(tmpdir(), "docs-http-"));
  await writeFile(join(staticDir, "index.html"), "<h1>landing</h1>");
  await mkdir(join(staticDir, "assets"), { recursive: true });
  await writeFile(join(staticDir, "assets", "app.css"), "body{}");
  // A secret file OUTSIDE the static root, one level up, to prove the jail.
  await writeFile(join(staticDir, "..", "docs-http-secret.txt"), "TOPSECRET");

  // The closure captures this array by reference; the real Host header sent
  // to an ephemeral port is `127.0.0.1:<port>`, so push it once we know the
  // port (production behind Fly sends `docs.erfi.io` with no port).
  const allowedHosts = ["localhost", "127.0.0.1"];
  server = createHttpServer({
    service: stubService,
    staticDir,
    allowedHosts,
    allowedOrigins: ["https://claude.ai"],
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  allowedHosts.push(`127.0.0.1:${port}`, `localhost:${port}`);
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("HTTP: liveness + routing", () => {
  it("GET /healthz returns 200 ok", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("GET /mcp is 405 (stateless, no server-initiated streams)", async () => {
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.message).toContain("Method Not Allowed");
  });

  it("unknown path with no static match is 404", async () => {
    const res = await fetch(`${base}/nope/not-a-file`);
    expect(res.status).toBe(404);
  });
});

describe("HTTP: static serving + jail", () => {
  it("GET / serves the landing index.html", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("landing");
  });

  it("serves a nested static asset with the right MIME", async () => {
    const res = await fetch(`${base}/assets/app.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("does NOT serve files outside the static root (jail holds)", async () => {
    // Raw traversal via the URL path - fetch normalises, so hit the server
    // with an un-normalised path directly.
    const res = await fetch(`${base}/../docs-http-secret.txt`);
    expect(res.status).toBe(404);
    const txt = await res.text();
    expect(txt).not.toContain("TOPSECRET");
  });
});

describe("HTTP: request body handling", () => {
  it("rejects a non-JSON body on POST /mcp with 400", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body (>1MB)", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: "x".repeat(1_048_577),
    });
    // The 1MB guard fires -> body parse rejects -> 400.
    expect(res.status).toBe(400);
  });
});

describe("HTTP: MCP protocol over the wire", () => {
  it("handles an initialize request and reports serverInfo", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("docs-ssh");
    expect(body.result.capabilities).toHaveProperty("tools");
  });

  it("rejects a request with a disallowed Host header (DNS rebinding)", async () => {
    // undici's fetch ignores a user-set Host header, so use raw node:http
    // where the Host header is sent literally.
    const { port } = server.address() as AddressInfo;
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            Host: "evil.example.com",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" },
          },
        }),
      );
    });
    expect(status).toBe(403);
  });
});
