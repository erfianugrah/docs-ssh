/**
 * Converts incident.io status-page data into per-incident markdown.
 *
 * incident.io (e.g. status.supabase.com, migrated from Atlassian
 * Statuspage in 2026-10) exposes incidents through a proxy API:
 *  - `<base>/proxy/<host>/incidents` - `{"incidents":[...]}` with every
 *    incident in a rolling ~3-month window. No paging; query params
 *    (page/limit/before/offset/cursor) are ignored.
 *  - `<base>/proxy/<host>/incidents/<id>` - `{"incident":{...}}` with the
 *    full update timeline.
 *
 * Because the API only serves the rolling window, the mirror loses older
 * incidents over time. `loadCarriedArchive` reads the previous output dir
 * so older incident files survive across fetches (fresh wins on collision).
 *
 * Like statuspage-converter.ts this splits into a pure converter
 * (`incidentToMarkdown`, unit-testable with no network) and the
 * list-parsing helper (`collectIncidentIds`) that HttpIngestor drives.
 *
 * The payload carries component IDs, not names (`component_impacts[].
 * component_id`, `component_statuses[].component_id`); `affected_components`
 * is empty in practice. The converter summarises component impacts by
 * status only.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DocFile } from "../domain/DocFile.js";
import { walkDir } from "../shared/walkDir.js";

// ─── Types (subset of the incident.io JSON we consume) ───────────────

export interface IncidentioComponentImpact {
  component_id?: string;
  status?: string;
  start_at?: string;
  end_at?: string;
}

export interface IncidentioUpdateComponentStatus {
  component_id?: string;
  status?: string;
}

/**
 * `message` is a mrkdwn node (text_node tree + pre-rendered `markdown`).
 * `message_string` is the plain-text rendering and is present on every
 * real payload; it is preferred when available.
 */
export interface IncidentioMessage {
  markdown?: string;
  text_node?: {
    type?: string;
    content?: Array<{ type?: string; text?: string; content?: unknown[] }>;
  };
}

export interface IncidentioUpdate {
  id?: string;
  to_status?: string;
  published_at?: string;
  message?: IncidentioMessage;
  message_string?: string;
  component_statuses?: IncidentioUpdateComponentStatus[];
  automated_update?: boolean;
}

export interface IncidentioIncident {
  id?: string;
  name?: string;
  status?: string;
  type?: string;
  published_at?: string;
  status_page_id?: string;
  affected_components?: unknown[];
  component_impacts?: IncidentioComponentImpact[];
  status_summaries?: unknown[];
  updates?: IncidentioUpdate[];
}

export interface IncidentioList {
  incidents?: IncidentioIncident[];
}

export interface IncidentioDetail {
  incident?: IncidentioIncident;
}

export interface IncidentFile {
  path: string;
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function isoDate(s?: string): string {
  if (!s) return "";
  // Trim milliseconds for readability: 2026-07-02T22:59:32.860Z -> 2026-07-02T22:59:32Z
  return s.replace(/\.\d+Z$/, "Z");
}

/**
 * Update text: prefer `message_string`; derive from `message.markdown`;
 * last resort walk the text_node tree collecting paragraph text.
 */
export function updateToText(update: IncidentioUpdate): string {
  const plain = update.message_string?.trim();
  if (plain) return plain;
  const md = update.message?.markdown?.trim();
  if (md) return md;
  const parts: string[] = [];
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (typeof n !== "object" || n === null) continue;
      const node = n as { type?: string; text?: string; content?: unknown };
      if (node.type === "text" && node.text) parts.push(node.text);
      if (node.content) walk(node.content);
    }
  };
  walk(update.message?.text_node?.content ?? []);
  return parts.join("\n\n");
}

// ─── Pure converter ───────────────────────────────────────────────────

/**
 * Convert one incident's JSON into a markdown file under
 * `incidents/<id>.md`. `id` is passed explicitly because the public page
 * (and the filename) key off it even if the field is ever absent.
 */
export function incidentToMarkdown(incident: IncidentioIncident, id: string, baseUrl: string): IncidentFile {
  const name = (incident.name ?? "Untitled incident").trim();
  const status = incident.status ?? "unknown";
  const type = incident.type ?? "unknown";
  const published = isoDate(incident.published_at);

  const lines: string[] = [`# ${name}`, ""];

  const meta: string[] = [`**Status:** ${status}`, `**Type:** ${type}`];
  if (published) meta.push(`**Published:** ${published}`);
  lines.push(meta.join(" · "), "");

  const impacts = incident.component_impacts ?? [];
  const impactStatuses = [...new Set(impacts.map((i) => i.status?.trim()).filter((s): s is string => !!s))];
  if (impacts.length > 0) {
    lines.push(
      `**Affected components:** ${impacts.length}` +
        (impactStatuses.length > 0 ? ` (${impactStatuses.join(", ")})` : ""),
      "",
    );
  }

  const updates = [...(incident.updates ?? [])].sort(
    (a, b) => new Date(a.published_at ?? 0).getTime() - new Date(b.published_at ?? 0).getTime(),
  );
  if (updates.length > 0) {
    lines.push("## Timeline", "");
    for (const u of updates) {
      const ts = isoDate(u.published_at);
      const st = u.to_status ?? "update";
      lines.push(`### ${st}${ts ? ` - ${ts}` : ""}`, "");
      const text = updateToText(u).trim();
      if (text) lines.push(text, "");
    }
  }

  return { path: `incidents/${id}.md`, content: `${lines.join("\n").trimEnd()}\n` };
}

// ─── List parsing (pure) ──────────────────────────────────────────────

/**
 * Extract de-duplicated incident ids from a `/incidents` list payload.
 * The list is a rolling window with no paging, so one call is the whole
 * set.
 */
export function collectIncidentIds(list: IncidentioList): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const inc of list.incidents ?? []) {
    const id = inc.id?.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

// ─── Archive carry-forward ────────────────────────────────────────────

/**
 * Merge carried archive files into a fresh file set. Fresh wins on
 * collision; carried paths not present in `fresh` are appended. Returns
 * the merged map plus how many files were carried.
 */
export function mergeCarriedArchive(
  fresh: Map<string, DocFile>,
  carried: Map<string, DocFile>,
): { files: Map<string, DocFile>; carriedCount: number } {
  const files = new Map(fresh);
  let carriedCount = 0;
  for (const [p, file] of carried) {
    if (!files.has(p)) {
      files.set(p, file);
      carriedCount++;
    }
  }
  return { files, carriedCount };
}

/**
 * Read the previous output dir of an incidentio source and return every
 * `*.md` file (root-level Atlassian-era `<code>.md` archives and
 * `incidents/<id>.md` alike) as a path -> DocFile map. Origin URLs come
 * from the previous `.stamp.json` `origins` map when present.
 *
 * A missing dir or stamp yields an empty map - nothing to carry.
 */
export async function loadCarriedArchive(prevSourceDir: string): Promise<Map<string, DocFile>> {
  let origins: Record<string, string> = {};
  try {
    const stamp = JSON.parse(await fs.readFile(path.join(prevSourceDir, ".stamp.json"), "utf-8")) as {
      origins?: Record<string, string>;
    };
    if (stamp?.origins && typeof stamp.origins === "object") origins = stamp.origins;
  } catch {
    // No stamp - carry files without origin URLs.
  }
  const files = new Map<string, DocFile>();
  try {
    await walkDir(prevSourceDir, prevSourceDir, files, {
      extensions: new Set(["md"]),
      originUrl: (rel) => origins[rel],
    });
  } catch {
    // No previous output dir - nothing to carry.
  }
  return files;
}
