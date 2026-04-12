import { describe, it, expect } from "vitest";
import { convertOpenApiToMarkdown } from "../../../src/ingestors/openapi-converter.js";

/** Helper: build a minimal OpenAPI 3.x spec as a JSON string. */
function makeSpec(
  paths: Record<string, unknown>,
  components?: Record<string, unknown>,
  info?: Record<string, unknown>,
): string {
  return JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0", ...info },
    paths,
    ...(components ? { components } : {}),
  });
}

describe("openapi-converter", () => {
  // ─── Basic structure ────────────────────────────────────────────

  it("generates overview and per-tag files", () => {
    const spec = makeSpec({
      "/items": {
        get: { tags: ["items"], summary: "List items", responses: { "200": { description: "OK" } } },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    expect(files.map((f) => f.path)).toEqual(["api/overview.md", "api/items.md"]);
  });

  it("overview contains endpoint group count", () => {
    const spec = makeSpec({
      "/a": { get: { tags: ["alpha"], summary: "A", responses: {} } },
      "/b": { get: { tags: ["beta"], summary: "B", responses: {} } },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const overview = files.find((f) => f.path === "api/overview.md")!;
    expect(overview.content).toContain("**alpha** — 1 endpoints");
    expect(overview.content).toContain("**beta** — 1 endpoints");
  });

  // ─── $ref resolution ───────────────────────────────────────────

  it("resolves simple $ref in response schema", () => {
    const spec = makeSpec(
      {
        "/users": {
          get: {
            tags: ["users"],
            summary: "List users",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
              },
            },
          },
        },
      },
      {
        schemas: {
          User: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "integer" }, name: { type: "string" } },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const users = files.find((f) => f.path === "api/users.md")!;
    expect(users.content).toContain("id: integer");
    expect(users.content).toContain("name?: string");
    expect(users.content).not.toContain("`any`");
  });

  it("resolves $ref in request body", () => {
    const spec = makeSpec(
      {
        "/users": {
          post: {
            tags: ["users"],
            summary: "Create user",
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateUser" } } },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
      {
        schemas: {
          CreateUser: {
            type: "object",
            required: ["email"],
            properties: { email: { type: "string" }, name: { type: "string" } },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const users = files.find((f) => f.path === "api/users.md")!;
    expect(users.content).toContain("email: string");
    expect(users.content).toContain("name?: string");
  });

  it("resolves nested $refs (ref inside ref)", () => {
    const spec = makeSpec(
      {
        "/orders": {
          post: {
            tags: ["orders"],
            summary: "Create order",
            requestBody: {
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateOrder" } } },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
      {
        schemas: {
          OrderItem: {
            type: "object",
            properties: { sku: { type: "string" }, qty: { type: "integer" } },
          },
          CreateOrder: {
            type: "object",
            required: ["items"],
            properties: {
              items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
            },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const orders = files.find((f) => f.path === "api/orders.md")!;
    expect(orders.content).toContain("sku?: string");
    expect(orders.content).toContain("qty?: integer");
  });

  it("handles circular $refs without infinite loop", () => {
    const spec = makeSpec(
      {
        "/nodes": {
          get: {
            tags: ["tree"],
            summary: "Get tree",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { $ref: "#/components/schemas/TreeNode" } } },
              },
            },
          },
        },
      },
      {
        schemas: {
          TreeNode: {
            type: "object",
            properties: {
              name: { type: "string" },
              children: { type: "array", items: { $ref: "#/components/schemas/TreeNode" } },
            },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const tree = files.find((f) => f.path === "api/tree.md")!;
    expect(tree.content).toContain("name?: string");
    // Circular ref should not crash — children become object[] or similar
    expect(tree.content).toContain("children?:");
  });

  it("resolves oneOf with $refs", () => {
    const spec = makeSpec(
      {
        "/events": {
          post: {
            tags: ["events"],
            summary: "Create event",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/ClickEvent" },
                      { $ref: "#/components/schemas/ViewEvent" },
                    ],
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
      {
        schemas: {
          ClickEvent: {
            type: "object",
            properties: { type: { type: "string", enum: ["click"] }, x: { type: "integer" } },
          },
          ViewEvent: {
            type: "object",
            properties: { type: { type: "string", enum: ["view"] }, page: { type: "string" } },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const events = files.find((f) => f.path === "api/events.md")!;
    expect(events.content).toContain('"click"');
    expect(events.content).toContain('"view"');
    expect(events.content).toContain("x?: integer");
    expect(events.content).toContain("page?: string");
  });

  it("resolves allOf with $refs", () => {
    const spec = makeSpec(
      {
        "/items": {
          get: {
            tags: ["items"],
            summary: "Get item",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      allOf: [
                        { $ref: "#/components/schemas/Base" },
                        { type: "object", properties: { extra: { type: "string" } } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        schemas: {
          Base: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "integer" } },
          },
        },
      },
    );
    const files = convertOpenApiToMarkdown(spec, "test");
    const items = files.find((f) => f.path === "api/items.md")!;
    // allOf produces "type1 & type2"
    expect(items.content).toContain("id: integer");
    expect(items.content).toContain("extra?: string");
  });

  // ─── Inline schemas (no $ref) ──────────────────────────────────

  it("renders inline schemas without $ref", () => {
    const spec = makeSpec({
      "/health": {
        get: {
          tags: ["system"],
          summary: "Health check",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { status: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const sys = files.find((f) => f.path === "api/system.md")!;
    expect(sys.content).toContain("status?: string");
  });

  // ─── Parameters ────────────────────────────────────────────────

  it("renders path and query parameters", () => {
    const spec = makeSpec({
      "/items/{id}": {
        get: {
          tags: ["items"],
          summary: "Get item",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "fields", in: "query", schema: { type: "string" }, description: "Fields to return" },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const items = files.find((f) => f.path === "api/items.md")!;
    expect(items.content).toContain("`id` (string, required)");
    expect(items.content).toContain("`fields` (string)");
    expect(items.content).toContain("Fields to return");
  });

  // ─── Auth and deprecation ──────────────────────────────────────

  it("marks deprecated endpoints", () => {
    const spec = makeSpec({
      "/old": {
        get: {
          tags: ["legacy"],
          summary: "Old endpoint",
          deprecated: true,
          responses: { "200": { description: "OK" } },
        },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const legacy = files.find((f) => f.path === "api/legacy.md")!;
    expect(legacy.content).toContain("~~DEPRECATED~~");
  });

  it("shows auth requirements", () => {
    const spec = makeSpec({
      "/secure": {
        get: {
          tags: ["protected"],
          summary: "Secure endpoint",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "OK" } },
        },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const prot = files.find((f) => f.path === "api/protected.md")!;
    expect(prot.content).toContain("Auth: bearerAuth");
  });

  // ─── Swagger 2.0 ──────────────────────────────────────────────

  it("handles Swagger 2.0 specs", () => {
    const spec = JSON.stringify({
      swagger: "2.0",
      info: { title: "Swagger Test", version: "1.0.0" },
      paths: {
        "/pets": {
          get: {
            tags: ["pets"],
            summary: "List pets",
            parameters: [{ name: "limit", in: "query", type: "integer" }],
            responses: {
              "200": {
                description: "OK",
                schema: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
              },
            },
          },
        },
      },
    });
    const files = convertOpenApiToMarkdown(spec, "test");
    const overview = files.find((f) => f.path === "api/overview.md")!;
    expect(overview.content).toContain("Swagger 2.0");
    const pets = files.find((f) => f.path === "api/pets.md")!;
    expect(pets.content).toContain("name?: string");
  });
});
