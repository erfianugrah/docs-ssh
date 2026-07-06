/**
 * Converts Atlassian Statuspage incident data into per-incident markdown.
 *
 * Statuspage exposes the full incident history through two JSON endpoints:
 *  - `/history.json?page=N` - paginated index (3 months/page) listing every
 *    incident with its `code`. Paginate until a page yields zero incidents.
 *  - `/incidents/<code>.json` - a single incident with the full update
 *    timeline (`incident_updates[]`: investigating -> identified -> monitoring
 *    -> resolved) plus `postmortem_body`, `impact`, `resolved_at`, components.
 *
 * Resolved incidents never change, so the mirror caches perfectly.
 *
 * This module is split into a pure converter (`incidentToMarkdown`, unit-testable
 * with no network) and the paging helpers (`collectIncidentCodes`) that
 * HttpIngestor drives. Same shape as openapi-converter.ts.
 */

// ─── Types (subset of the Statuspage JSON we consume) ───────────────

export interface StatuspageComponent {
  name?: string;
}

export interface StatuspageIncidentUpdate {
  status?: string;
  body?: string;
  created_at?: string;
  display_at?: string;
}

export interface StatuspageIncident {
  code?: string;
  id?: string;
  name?: string;
  impact?: string;
  status?: string;
  shortlink?: string;
  created_at?: string;
  started_at?: string;
  resolved_at?: string;
  monitoring_at?: string;
  postmortem_body?: string | null;
  postmortem_published_at?: string | null;
  components?: StatuspageComponent[];
  incident_updates?: StatuspageIncidentUpdate[];
}

/** One month bucket in /history.json. */
interface HistoryMonth {
  name?: string;
  incidents?: Array<{ code?: string }>;
}
interface HistoryPage {
  months?: HistoryMonth[];
}

export interface IncidentFile {
  path: string;
  content: string;
}

// ─── HTML -> markdown cleanup ───────────────────────────────────────

/**
 * Statuspage update bodies are mostly plain text but occasionally embed
 * `<a href="...">...</a>` anchors and stray entities. Convert anchors to
 * markdown links, strip any other tags, and decode the common entities.
 * The `<var data-var='date'>N</var>` widgets only appear in the /history.json
 * `timestamp` field (which we don't use) - update bodies use ISO timestamps.
 */
export function cleanBody(raw: string): string {
  if (!raw) return "";
  let s = raw;
  // <a href="X">text</a> -> [text](X)
  s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
    const label = text.replace(/<[^>]+>/g, "").trim() || href;
    return `[${label}](${href})`;
  });
  // Drop any remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // Decode the handful of entities Statuspage emits.
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Collapse 3+ blank lines and trailing whitespace.
  return s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function isoDate(s?: string): string {
  if (!s) return "";
  // Trim milliseconds for readability: 2026-07-02T22:59:32.860Z -> 2026-07-02T22:59:32Z
  return s.replace(/\.\d+Z$/, "Z");
}

// ─── Pure converter ─────────────────────────────────────────────────

/**
 * Convert one incident's JSON into a markdown file. `code` is passed
 * explicitly because the per-incident JSON keys the code under `code`
 * but we want a stable filename even if that field is ever absent.
 */
export function incidentToMarkdown(
  incident: StatuspageIncident,
  code: string,
  baseUrl: string,
): IncidentFile {
  const name = (incident.name ?? "Untitled incident").trim();
  const impact = incident.impact ?? "unknown";
  const status = incident.status ?? "unknown";
  const created = isoDate(incident.started_at ?? incident.created_at);
  const resolved = isoDate(incident.resolved_at ?? undefined);
  const components = (incident.components ?? [])
    .map((c) => c.name?.trim())
    .filter((n): n is string => !!n);
  const page = `${baseUrl.replace(/\/$/, "")}/incidents/${code}`;

  // Updates come newest-first from Statuspage; render chronologically
  // (oldest-first) so the timeline reads investigating -> resolved.
  const updates = [...(incident.incident_updates ?? [])].reverse();

  const fm: string[] = ["---"];
  fm.push(`code: ${code}`);
  fm.push(`name: ${yamlScalar(name)}`);
  fm.push(`impact: ${impact}`);
  fm.push(`status: ${status}`);
  if (created) fm.push(`created_at: ${created}`);
  if (resolved) fm.push(`resolved_at: ${resolved}`);
  if (components.length > 0) fm.push(`components: [${components.map(yamlScalar).join(", ")}]`);
  if (incident.shortlink) fm.push(`shortlink: ${incident.shortlink}`);
  fm.push(`page: ${page}`);
  fm.push("---");

  const lines: string[] = [fm.join("\n"), "", `# ${name}`, ""];

  const meta: string[] = [`**Impact:** ${impact}`, `**Status:** ${status}`];
  if (created) meta.push(`**Started:** ${created}`);
  if (resolved) meta.push(`**Resolved:** ${resolved}`);
  lines.push(meta.join(" · "), "");
  if (components.length > 0) {
    lines.push(`**Affected components:** ${components.join(", ")}`, "");
  }

  if (updates.length > 0) {
    lines.push("## Timeline", "");
    for (const u of updates) {
      const ts = isoDate(u.created_at ?? u.display_at);
      const st = u.status ?? "update";
      lines.push(`### ${st}${ts ? ` - ${ts}` : ""}`, "");
      const body = cleanBody(u.body ?? "");
      if (body) lines.push(body, "");
    }
  }

  const pm = cleanBody(incident.postmortem_body ?? "");
  if (pm) {
    lines.push("## Postmortem", "");
    if (incident.postmortem_published_at) {
      lines.push(`_Published ${isoDate(incident.postmortem_published_at)}_`, "");
    }
    lines.push(pm, "");
  }

  return { path: `${code}.md`, content: `${lines.join("\n").trimEnd()}\n` };
}

/** Quote a YAML scalar only when it contains characters that need it. */
function yamlScalar(s: string): string {
  if (/^[\w .,/()+-]+$/.test(s) && !/^\s|\s$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ─── Paging (network) ───────────────────────────────────────────────

/**
 * Walk /history.json?page=1..N until a page returns zero incidents, then
 * return the ordered, de-duplicated list of incident codes (newest first).
 *
 * `fetchJson` is injected so the pager is unit-testable without network.
 * `maxPages` is a safety valve against an upstream that never returns an
 * empty page.
 */
export async function collectIncidentCodes(
  baseUrl: string,
  fetchJson: (url: string) => Promise<unknown>,
  maxPages = 60,
): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, "");
  const codes: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const data = (await fetchJson(`${base}/history.json?page=${page}`)) as HistoryPage;
    const months = data?.months ?? [];
    let pageCount = 0;
    for (const m of months) {
      for (const inc of m.incidents ?? []) {
        pageCount++;
        const code = inc.code?.trim();
        if (code && !seen.has(code)) {
          seen.add(code);
          codes.push(code);
        }
      }
    }
    // A page with zero incidents means we've run past the oldest month.
    if (pageCount === 0) break;
  }
  return codes;
}
