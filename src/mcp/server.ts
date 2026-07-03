/**
 * MCP-over-HTTP server for docs.erfi.io.
 *
 * Exposes the six docs operations (search / read / grep / find / summary
 * / sources) as MCP tools over the Streamable HTTP transport, so remote
 * chat LLMs (Claude custom connectors, ChatGPT connectors) can use the
 * docs corpus directly - no SSH client required.
 *
 * Runs INSIDE the container against the local /docs tree via DocsService,
 * so there is no SSH round-trip. Stateless: a fresh McpServer + transport
 * is created per request (sessionIdGenerator: undefined), which means the
 * process holds no session state and can sit behind a CDN / load balancer.
 *
 * Spec: MCP 2025-11-25, Streamable HTTP transport (single /mcp endpoint,
 * POST for requests, GET returns 405 since we emit no server-initiated
 * streams). Origin/Host validation via enableDnsRebindingProtection.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { DocsService } from "./docs-service.js";

const VERSION = process.env.VERSION ?? "dev";
const DOCS_ROOT = process.env.DOCS_ROOT ?? "/docs";

// Hosts/origins allowed by DNS-rebinding protection. Extend via env
// (comma-separated) for self-hosted deployments.
const ALLOWED_HOSTS = (
  process.env.MCP_ALLOWED_HOSTS ?? "docs.erfi.io,docs-ssh.fly.dev,localhost,127.0.0.1"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = (
  process.env.MCP_ALLOWED_ORIGINS ??
  "https://claude.ai,https://chatgpt.com,https://chat.openai.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Optional static root: when set, GET requests outside /mcp are served as
// files (the landing page). Lets one listener carry both the landing page
// and the MCP endpoint on a single port - avoids the Fly one-service-per-
// external-port constraint. Unset in tests/dev, so static serving is off.
const STATIC_DIR = process.env.MCP_STATIC_DIR ?? "";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".css": "text/css",
  ".js": "text/javascript",
  ".txt": "text/plain; charset=utf-8",
};

const docs = new DocsService(DOCS_ROOT);

/** Serve a file from STATIC_DIR (jailed). Returns true if a file was sent. */
async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  if (!STATIC_DIR) return false;
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const base = normalize(STATIC_DIR);
  const full = normalize(join(base, rel));
  // Jail: resolved path must stay inside STATIC_DIR.
  if (full !== base && !full.startsWith(base + "/")) return false;
  try {
    const s = await stat(full);
    if (!s.isFile()) return false;
    const body = await readFile(full);
    res.writeHead(200, {
      "Content-Type": MIME[extname(full)] ?? "application/octet-stream",
      "Content-Length": body.length,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/** Build a fresh MCP server with the six docs tools registered. */
export function buildServer(service: DocsService = docs): McpServer {
  const server = new McpServer(
    { name: "docs-ssh", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Documentation search for docs.erfi.io. Call docs_search FIRST to find " +
        "files, then docs_read (use offset/lines on large files). docs_grep for " +
        "regex within a known source, docs_summary for an outline, docs_find by " +
        "filename, docs_sources to list available sources.",
    },
  );

  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  server.registerTool(
    "docs_search",
    {
      title: "Docs Search",
      description:
        "Search the docs.erfi.io title+summary index. Use this FIRST to find relevant docs.",
      inputSchema: {
        query: z.string().describe("Search text"),
        source: z
          .string()
          .optional()
          .describe("Filter to a source, e.g. 'supabase', 'aws'. Omit for all."),
        maxResults: z.number().optional().describe("Max results (default 15)"),
      },
    },
    async (args) => text(await service.search(args)),
  );

  server.registerTool(
    "docs_read",
    {
      title: "Docs Read",
      description:
        "Read a /docs/<source>/... file. Use offset+lines for large files.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("File path, e.g. /docs/supabase/guides/auth.md"),
        filePath: z.string().optional().describe("Alias for 'path'."),
        offset: z.number().optional().describe("Start line (1-indexed)."),
        lines: z.number().optional().describe("Read N lines. Omit for whole file."),
      },
    },
    async (args) => text(await service.read(args)),
  );

  server.registerTool(
    "docs_grep",
    {
      title: "Docs Grep",
      description: "Regex search inside /docs/<path>/ with context lines.",
      inputSchema: {
        query: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("File or dir path, e.g. /docs/postgres/"),
        filePath: z.string().optional().describe("Alias for 'path'."),
        context: z.number().optional().describe("Context lines per match (default 3)"),
      },
    },
    async (args) => text(await service.grep(args)),
  );

  server.registerTool(
    "docs_find",
    {
      title: "Docs Find",
      description: "Find docs files by name / glob pattern.",
      inputSchema: {
        pattern: z.string().describe("Glob pattern, e.g. '*.md', '*auth*'"),
        source: z.string().optional().describe("Filter to a source"),
        maxResults: z.number().optional().describe("Max results (default 30)"),
      },
    },
    async (args) => text(await service.find(args)),
  );

  server.registerTool(
    "docs_summary",
    {
      title: "Docs Summary",
      description: "Outline (headings only) of a docs file.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("File path, e.g. /docs/supabase/guides/auth.md"),
        filePath: z.string().optional().describe("Alias for 'path'."),
      },
    },
    async (args) => text(await service.summary(args)),
  );

  server.registerTool(
    "docs_sources",
    {
      title: "Docs Sources",
      description: "List docs.erfi.io sources with file counts.",
      inputSchema: {
        filter: z
          .string()
          .optional()
          .describe("Filter source names, e.g. 'postgres', 'supabase'"),
      },
    },
    async (args) => text(await service.sources(args)),
  );

  return server;
}

/** Read and JSON-parse an HTTP request body. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_048_576) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function jsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    }),
  );
}

export const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Liveness probe (used by Fly http_checks).
  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname !== "/mcp") {
    // Anything that isn't the MCP endpoint: try the static landing page.
    if (req.method === "GET" && (await serveStatic(res, url.pathname))) return;
    jsonRpcError(res, 404, "Not Found");
    return;
  }

  // Stateless server: no server-initiated streams, so GET/DELETE are 405.
  if (req.method !== "POST") {
    jsonRpcError(res, 405, "Method Not Allowed");
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    jsonRpcError(res, 400, "Invalid JSON body");
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // plain JSON, no SSE needed for pure reads
    enableDnsRebindingProtection: true, // spec-mandated Origin/Host validation
    allowedHosts: ALLOWED_HOSTS,
    allowedOrigins: ALLOWED_ORIGINS,
  });
  const server = buildServer();

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      jsonRpcError(res, 500, `Internal error: ${(err as Error).message}`);
    }
  }
});
