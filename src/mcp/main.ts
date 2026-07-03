/**
 * Entrypoint: start the docs-ssh MCP HTTP server.
 *
 * Kept separate from server.ts so tests can import buildServer / httpServer
 * without binding a port.
 */

import { httpServer } from "./server.js";

const PORT = Number(process.env.MCP_PORT ?? 8081);
const HOST = process.env.MCP_HOST ?? "0.0.0.0";
const VERSION = process.env.VERSION ?? "dev";
const DOCS_ROOT = process.env.DOCS_ROOT ?? "/docs";

httpServer.listen(PORT, HOST, () => {
  console.error(
    `docs-ssh MCP server on http://${HOST}:${PORT}/mcp (root=${DOCS_ROOT}, v${VERSION})`,
  );
});
