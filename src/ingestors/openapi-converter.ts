import yaml from "js-yaml";

/**
 * Converts an OpenAPI 3.x or Swagger 2.0 spec into condensed markdown files,
 * one per tag group. Designed for LLM consumption — maximises information
 * density while minimising token waste.
 */

interface SpecFile {
  path: string;
  content: string;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Parse a raw spec string (JSON or YAML) and convert to per-tag markdown files.
 * Returns [relativePath, markdownContent][] pairs.
 */
export function convertOpenApiToMarkdown(raw: string, sourceName: string): SpecFile[] {
  const spec = parseSpec(raw);
  if (!spec || typeof spec !== "object") {
    throw new Error("Failed to parse OpenAPI spec");
  }

  const resolved = resolveRefs(spec, spec) as Record<string, unknown>;

  const isSwagger2 = "swagger" in resolved;
  const info = (resolved.info ?? {}) as Record<string, unknown>;
  const paths = resolved.paths ?? {};

  // Group operations by tag
  const groups = new Map<string, OperationInfo[]>();

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (!op || typeof op !== "object") continue;

      const operation = op as Record<string, unknown>;
      const tags = (operation.tags as string[]) ?? ["default"];
      const opInfo = extractOperation(method, pathStr, operation, isSwagger2, resolved);

      for (const tag of tags) {
        const normalTag = tag.toLowerCase().replace(/\s+/g, "-");
        if (!groups.has(normalTag)) groups.set(normalTag, []);
        groups.get(normalTag)!.push(opInfo);
      }
    }
  }

  // Generate overview file
  const files: SpecFile[] = [];
  files.push({
    path: `api/overview.md`,
    content: renderOverview(info, groups, isSwagger2 ? "Swagger 2.0" : "OpenAPI 3.x"),
  });

  // Generate per-tag files
  for (const [tag, operations] of groups) {
    files.push({
      path: `api/${tag}.md`,
      content: renderTagGroup(tag, operations),
    });
  }

  return files;
}

// ─── Types ──────────────────────────────────────────────────────────

interface OperationInfo {
  method: string;
  path: string;
  summary: string;
  description: string;
  parameters: ParamInfo[];
  requestBody: string;
  responses: ResponseInfo[];
  auth: string;
  deprecated: boolean;
}

interface ParamInfo {
  name: string;
  in: string;
  type: string;
  required: boolean;
  description: string;
}

interface ResponseInfo {
  status: string;
  description: string;
  schema: string;
}

// ─── Spec Parsing ───────────────────────────────────────────────────

function parseSpec(raw: string): Record<string, unknown> {
  // Try JSON first (faster), fall back to YAML
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  return yaml.load(trimmed) as Record<string, unknown>;
}

// ─── $ref Resolution ────────────────────────────────────────────────

function resolveRefs(
  node: unknown,
  root: Record<string, unknown>,
  depth = 0,
  seen = new Set<string>(),
): unknown {
  if (depth > 15) return node; // prevent infinite recursion
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, root, depth + 1, seen));
  }

  const obj = node as Record<string, unknown>;
  if ("$ref" in obj && typeof obj.$ref === "string") {
    const ref = obj.$ref;
    if (seen.has(ref)) return { type: "object", description: `[circular: ${ref}]` };
    seen.add(ref);

    const resolved = followRef(ref, root);
    if (resolved !== undefined) {
      return resolveRefs(resolved, root, depth + 1, new Set(seen));
    }
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = resolveRefs(value, root, depth + 1, seen);
  }
  return result;
}

function followRef(ref: string, root: Record<string, unknown>): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Operation Extraction ───────────────────────────────────────────

function extractOperation(
  method: string,
  pathStr: string,
  op: Record<string, unknown>,
  isSwagger2: boolean,
  spec: Record<string, unknown>,
): OperationInfo {
  const params: ParamInfo[] = [];
  const rawParams = (op.parameters as Record<string, unknown>[]) ?? [];

  for (const p of rawParams) {
    if (!p || typeof p !== "object") continue;
    params.push({
      name: String(p.name ?? ""),
      in: String(p.in ?? ""),
      type: schemaToType(isSwagger2 ? p : (p as Record<string, unknown>).schema),
      required: Boolean(p.required),
      description: String(p.description ?? ""),
    });
  }

  // Request body (OpenAPI 3.x)
  let requestBody = "";
  if (!isSwagger2 && op.requestBody && typeof op.requestBody === "object") {
    const rb = op.requestBody as Record<string, unknown>;
    const content = rb.content as Record<string, unknown> | undefined;
    if (content) {
      const jsonContent = content["application/json"] as Record<string, unknown> | undefined;
      if (jsonContent?.schema) {
        requestBody = schemaToType(jsonContent.schema);
      }
    }
  }

  // Swagger 2.0 body param
  if (isSwagger2) {
    const bodyParam = rawParams.find((p) => p.in === "body");
    if (bodyParam?.schema) {
      requestBody = schemaToType(bodyParam.schema);
    }
  }

  // Responses
  const responses: ResponseInfo[] = [];
  const rawResponses = (op.responses ?? {}) as Record<string, unknown>;
  for (const [status, resp] of Object.entries(rawResponses)) {
    if (!resp || typeof resp !== "object") continue;
    const r = resp as Record<string, unknown>;
    let schema = "";
    if (isSwagger2 && r.schema) {
      schema = schemaToType(r.schema);
    } else if (r.content && typeof r.content === "object") {
      const content = r.content as Record<string, unknown>;
      const jsonContent = content["application/json"] as Record<string, unknown> | undefined;
      if (jsonContent?.schema) {
        schema = schemaToType(jsonContent.schema);
      }
    }
    responses.push({
      status,
      description: String(r.description ?? ""),
      schema,
    });
  }

  // Auth
  const security = (op.security ?? (spec as Record<string, unknown>).security) as
    | Record<string, unknown>[]
    | undefined;
  let auth = "";
  if (security && security.length > 0) {
    auth = security.map((s) => Object.keys(s).join(", ")).join(" | ");
  }

  return {
    method: method.toUpperCase(),
    path: pathStr,
    summary: String(op.summary ?? ""),
    description: String(op.description ?? ""),
    parameters: params,
    requestBody,
    responses,
    auth,
    deprecated: Boolean(op.deprecated),
  };
}

// ─── Schema → Type String ───────────────────────────────────────────

function schemaToType(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > 5) return "any";
  const s = schema as Record<string, unknown>;

  if (s.type === "array" && s.items) {
    return `${schemaToType(s.items, depth + 1)}[]`;
  }
  if (s.type === "object" || s.properties) {
    const props = s.properties as Record<string, unknown> | undefined;
    if (!props) return "object";
    const required = new Set((s.required as string[]) ?? []);
    const fields = Object.entries(props)
      .slice(0, 10) // limit to 10 fields for brevity
      .map(([k, v]) => {
        const t = schemaToType(v, depth + 1);
        return `${k}${required.has(k) ? "" : "?"}: ${t}`;
      });
    const suffix = Object.keys(props).length > 10 ? ", ..." : "";
    return `{ ${fields.join(", ")}${suffix} }`;
  }
  if (s.enum) {
    return (s.enum as unknown[]).slice(0, 5).map((e) => JSON.stringify(e)).join(" | ");
  }
  if (s.oneOf || s.anyOf) {
    const variants = (s.oneOf ?? s.anyOf) as unknown[];
    return variants
      .slice(0, 3)
      .map((v) => schemaToType(v, depth + 1))
      .join(" | ");
  }
  if (s.allOf) {
    const parts = (s.allOf as unknown[]).map((v) => schemaToType(v, depth + 1));
    return parts.join(" & ");
  }
  if (typeof s.type === "string") return s.type as string;
  return "any";
}

// ─── Markdown Rendering ─────────────────────────────────────────────

function renderOverview(
  info: Record<string, unknown>,
  groups: Map<string, OperationInfo[]>,
  specVersion: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${info.title ?? "API Reference"}`);
  if (info.description) lines.push("", String(info.description));
  lines.push("", `Version: ${info.version ?? "unknown"} (${specVersion})`);
  lines.push("", "## Endpoint Groups", "");

  for (const [tag, ops] of groups) {
    lines.push(`- **${tag}** — ${ops.length} endpoints`);
  }

  return lines.join("\n");
}

function renderTagGroup(tag: string, operations: OperationInfo[]): string {
  const lines: string[] = [];
  lines.push(`# ${tag}`, "");

  for (const op of operations) {
    const deprecated = op.deprecated ? " ~~DEPRECATED~~" : "";
    lines.push(`## ${op.method} ${op.path}${deprecated}`);
    if (op.summary) lines.push(op.summary);
    if (op.description && op.description !== op.summary) {
      lines.push("", op.description);
    }
    if (op.auth) lines.push("", `Auth: ${op.auth}`);

    // Parameters
    const queryParams = op.parameters.filter((p) => p.in === "query");
    const pathParams = op.parameters.filter((p) => p.in === "path");
    const headerParams = op.parameters.filter((p) => p.in === "header");

    if (pathParams.length > 0) {
      lines.push("", "### Path params");
      for (const p of pathParams) {
        lines.push(`- \`${p.name}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`);
      }
    }
    if (queryParams.length > 0) {
      lines.push("", "### Query params");
      for (const p of queryParams) {
        lines.push(`- \`${p.name}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`);
      }
    }
    if (headerParams.length > 0) {
      lines.push("", "### Headers");
      for (const p of headerParams) {
        lines.push(`- \`${p.name}\` (${p.type}${p.required ? ", required" : ""}): ${p.description}`);
      }
    }

    // Request body
    if (op.requestBody) {
      lines.push("", `### Body: \`${op.requestBody}\``);
    }

    // Responses
    if (op.responses.length > 0) {
      lines.push("", "### Responses");
      for (const r of op.responses) {
        const schema = r.schema ? ` → \`${r.schema}\`` : "";
        lines.push(`- **${r.status}**: ${r.description}${schema}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
