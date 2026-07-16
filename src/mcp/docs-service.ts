/**
 * DocsService - transport-agnostic core for the six docs operations.
 *
 * This is the shared logic behind BOTH the SSH builtins (via the Pi
 * extension, which SSHes in and runs the same shell commands remotely)
 * and the MCP-over-HTTP server (which runs them locally against the
 * in-container /docs tree, no SSH hop).
 *
 * The command strings are intentionally identical to the ones in
 * src/commands/tools-pi-template.ts - same rg/bat/find/awk pipelines,
 * same output formatting (capOutput / parseRgJson / formatRgMatches),
 * same safePath jail. The only difference is the docs root is
 * configurable (default /docs) and commands run locally instead of
 * over SSH.
 */

import { spawn } from "node:child_process";

export const MAX_RESULT_CHARS = 51_200;

/** Runs a shell command, returns trimmed stdout + exit code. */
export type Runner = (
  command: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Minimal FIFO concurrency limiter: caps the number of in-flight async
 * operations at `max`, queueing the rest. Used to bound how many bash
 * subprocesses the MCP path spawns at once, so a burst of concurrent
 * tools/call requests can't fork-bomb the container with `rg`/`find`.
 */
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < max && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  };
}

/**
 * Default runner: `bash -c <command>` via node:child_process (works under
 * Node + Bun). Bounded to `maxConcurrent` simultaneous subprocesses.
 */
export function bashRunner(timeoutMs = 60_000, maxConcurrent = 8): Runner {
  const limit = createLimiter(maxConcurrent);
  return (command: string) =>
    limit(
      () =>
        new Promise((resolve) => {
          const child = spawn("/bin/bash", ["-c", command], {
            stdio: ["ignore", "pipe", "pipe"],
            timeout: timeoutMs,
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d) => {
            stdout += d;
          });
          child.stderr.on("data", (d) => {
            stderr += d;
          });
          child.on("error", (err) => {
            resolve({ stdout: "", stderr: String(err), exitCode: 255 });
          });
          child.on("close", (code, signal) => {
            // SIGTERM from the timeout maps to the same 124 the SSH layer uses.
            const exitCode = signal === "SIGTERM" ? 124 : (code ?? 0);
            resolve({ stdout, stderr, exitCode });
          });
        }),
    );
}

// --- Helpers (lifted verbatim from tools-pi-template.ts) ------------

function sq(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// Split a query into AND-terms. Double-quoted spans stay whole (phrase
// match); everything else splits on whitespace. Always returns >= 1
// token so an empty / all-quotes edge case still yields a runnable cmd.
export function tokenizeQuery(q: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    const t = (m[1] ?? m[2]).trim();
    if (t) tokens.push(t);
  }
  return tokens.length ? tokens : [q.trim()];
}

// OR-match of `rg -i` over a file: any token may match the row. This
// used to be an AND-chain (every token required on the same row), but
// title+summary lines rarely contain every word of a natural-language
// query verbatim - "password reset email verification" AND-chained
// against the index returns ZERO rows even though the four topics are
// all covered (auth-captcha.md, passwords.md, auth-smtp.md, ...) because
// no single line's title+summary happens to contain all four words.
// OR-matching plus rankByTokenHits (surfacing the row hitting the most
// distinct tokens first) is what session_search's "auto-OR" semantics
// actually mean - the old code's AND-chain was mislabeled as matching
// that behaviour.
export function rgOrChain(tokens: string[], file: string): string {
  const args = tokens.map((t) => `-e '${sq(t)}'`).join(" ");
  return `rg -i ${args} ${file}`;
}

// OR-match of `rg -il` over a directory: any token may match a file's
// content. A single rg call suffices (no xargs staging needed - that
// was only required to narrow a candidate set AND-wise, stage by stage).
export function rgFilesOrChain(tokens: string[], dir: string): string {
  const args = tokens.map((t) => `-e '${sq(t)}'`).join(" ");
  return `rg -il ${args} '${dir}' 2>/dev/null`;
}

// Rank OR-matched lines by how many distinct query tokens they hit
// (case-insensitive substring match), stable on ties (preserves the
// upstream order - _index.tsv is roughly source-alphabetical).
export function rankByTokenHits(lines: string[], tokens: string[]): string[] {
  if (tokens.length <= 1) return lines;
  const lower = tokens.map((t) => t.toLowerCase());
  return lines
    .map((line, i) => {
      const lc = line.toLowerCase();
      const score = lower.reduce((n, t) => n + (lc.includes(t) ? 1 : 0), 0);
      return { line, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.line);
}

interface RgMatch {
  path: string;
  line: number;
  text: string;
  submatches?: Array<{ start: number; end: number }>;
}

function parseRgJson(raw: string): RgMatch[] {
  const matches: RgMatch[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "match") {
        const d = obj.data;
        matches.push({
          path: d.path?.text ?? "",
          line: d.line_number ?? 0,
          text: (d.lines?.text ?? "").replace(/\n$/, ""),
          submatches: d.submatches?.map((s: { start: number; end: number }) => ({
            start: s.start,
            end: s.end,
          })),
        });
      }
    } catch {
      // Skip malformed lines
    }
  }
  return matches;
}

function formatRgMatches(matches: RgMatch[]): string {
  if (matches.length === 0) return "";
  const lines: string[] = [];
  let lastPath = "";
  for (const m of matches) {
    if (m.path !== lastPath) {
      if (lastPath) lines.push("");
      lines.push(m.path);
      lastPath = m.path;
    }
    let text = m.text;
    if (m.submatches && m.submatches.length > 0) {
      const sorted = [...m.submatches].sort((a, b) => b.start - a.start);
      for (const s of sorted) {
        text =
          text.slice(0, s.start) +
          "**" +
          text.slice(s.start, s.end) +
          "**" +
          text.slice(s.end);
      }
    }
    lines.push(`  ${m.line}: ${text}`);
  }
  return lines.join("\n");
}

// --- Params ---------------------------------------------------------

export interface SearchParams {
  query: string;
  source?: string;
  maxResults?: number;
}
export interface ReadParams {
  path?: string;
  filePath?: string;
  offset?: number;
  lines?: number;
}
export interface GrepParams {
  query: string;
  path?: string;
  filePath?: string;
  context?: number;
}
export interface FindParams {
  pattern: string;
  source?: string;
  maxResults?: number;
}
export interface SummaryParams {
  path?: string;
  filePath?: string;
}
export interface SourcesParams {
  filter?: string;
}

export class DocsService {
  private readonly root: string;

  constructor(
    root: string = process.env.DOCS_ROOT ?? "/docs",
    private readonly run: Runner = bashRunner(),
  ) {
    // Normalise: strip trailing slash so `${root}/...` never doubles.
    this.root = root.replace(/\/+$/, "");
  }

  // --- Result cache -------------------------------------------------
  // Docs are immutable per container lifetime and all six ops are
  // idempotent reads, so identical (op,args) calls can serve a cached
  // result - mirroring the tmpfs cache the SSH ForceCommand path uses
  // (log-cmd.sh). Bounded insertion-order Map = simple LRU; transient
  // errors (timeouts / command failures) are never cached.
  private readonly cache = new Map<string, string>();
  private static readonly CACHE_MAX = 512;

  private async cached(
    op: string,
    params: unknown,
    fn: () => Promise<string>,
  ): Promise<string> {
    const key = `${op}:${JSON.stringify(params)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key); // refresh recency (move to newest)
      this.cache.set(key, hit);
      return hit;
    }
    const val = await fn();
    // Don't cache transient failures - a timeout/error should be retryable.
    if (!val.startsWith("[error]") && !val.includes("[error] command timed out")) {
      this.cache.set(key, val);
      if (this.cache.size > DocsService.CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return val;
  }

  // Public API: thin, transparent cache wrappers over the *Impl methods.
  search(p: SearchParams): Promise<string> {
    return this.cached("search", p, () => this.searchImpl(p));
  }
  read(p: ReadParams): Promise<string> {
    return this.cached("read", p, () => this.readImpl(p));
  }
  grep(p: GrepParams): Promise<string> {
    return this.cached("grep", p, () => this.grepImpl(p));
  }
  find(p: FindParams): Promise<string> {
    return this.cached("find", p, () => this.findImpl(p));
  }
  summary(p: SummaryParams): Promise<string> {
    return this.cached("summary", p, () => this.summaryImpl(p));
  }
  sources(p: SourcesParams): Promise<string> {
    return this.cached("sources", p, () => this.sourcesImpl(p));
  }

  private capOutput(text: string, path?: string): string {
    if (text.length <= MAX_RESULT_CHARS) return text;
    let end = MAX_RESULT_CHARS;
    const lastCode = text.charCodeAt(end - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) end--;
    const truncated = text.slice(0, end);
    const remaining = text.length - end;
    const hint = path
      ? `\n\n[truncated ${remaining} chars - use docs_read with offset/lines or docs_summary to target specific sections of ${path}]`
      : `\n\n[truncated ${remaining} chars - narrow your query or add a line limit]`;
    return truncated + hint;
  }

  private resolvePath(args: { path?: string; filePath?: string }): string {
    const v = args.path ?? args.filePath;
    if (typeof v !== "string" || v.length === 0) {
      throw new Error("'path' is required (alias: 'filePath').");
    }
    return v;
  }

  /**
   * Jail a caller-supplied path inside the docs root. Strips `../`
   * traversal, collapses `//`, and forces a `${root}/` prefix. The
   * public-facing paths use the literal `/docs/` prefix, so callers may
   * pass either `/docs/foo` or `foo`; both resolve under the real root.
   */
  private safePath(p: string): string {
    if (typeof p !== "string" || p.length === 0) {
      throw new Error("path is required (string).");
    }
    let cleaned = p;
    let prev: string;
    do {
      prev = cleaned;
      cleaned = cleaned
        .replace(/\.\.\//g, "")
        .replace(/\.\.\\/g, "")
        .replace(/\/\/+/g, "/");
    } while (cleaned !== prev);
    // Accept the public "/docs/..." form and rebase onto the real root.
    cleaned = cleaned.replace(/^\/docs\//, "").replace(/^\/+/, "");
    return `${this.root}/${cleaned}`;
  }

  private async exec(command: string): Promise<string> {
    const { stdout, stderr, exitCode } = await this.run(command);
    if (exitCode === 124 || exitCode === 143) {
      return `[error] command timed out on the docs server (DOCS_CMD_TIMEOUT). Narrow the query or split into smaller reads.`;
    }
    if (exitCode === 255) {
      return `[error] ${stderr.trim() || "command failed"}`;
    }
    if (exitCode !== 0 && !stdout.trim() && stderr.trim()) {
      return `[error] ${stderr.trim()}`;
    }
    return stdout.trim();
  }

  private async searchImpl(params: SearchParams): Promise<string> {
    const limit = params.maxResults ?? 15;
    const tokens = tokenizeQuery(params.query);
    const filter = params.source ? `| rg '^${sq(params.source)}/'` : "";
    const raw = await this.exec(
      `${rgOrChain(tokens, `${this.root}/_index.tsv`)} ${filter}`,
    );
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) {
      const dir = params.source
        ? this.safePath(`/docs/${sq(params.source)}/`)
        : this.root + "/";
      const inameOr = tokens.map((t) => `-iname '*${sq(t)}*'`).join(" -o ");
      const [fileMatch, contentMatch] = await Promise.all([
        this.exec(`find '${dir}' -type f \\( ${inameOr} \\) | head -${limit}`),
        this.exec(`${rgFilesOrChain(tokens, dir)} | head -${limit}`),
      ]);
      const combined = [
        ...new Set(
          [...fileMatch.split("\n"), ...contentMatch.split("\n")].filter(Boolean),
        ),
      ];
      if (combined.length) {
        return `[no index matches - found via filename/content search]\n${combined
          .slice(0, limit)
          .join("\n")}`;
      }
      return `[no results for "${params.query}"${params.source ? ` in ${params.source}` : ""}]`;
    }
    const ranked = rankByTokenHits(lines, tokens);
    const top = ranked.slice(0, limit);
    return ranked.length > limit
      ? `${top.join("\n")}\n[showing ${limit} of ${ranked.length} results - refine query or add source filter]`
      : top.join("\n");
  }

  private async readImpl(params: ReadParams): Promise<string> {
    const argPath = this.resolvePath(params);
    const p = this.safePath(argPath);
    let cmd: string;

    if (params.offset) {
      const start = Math.max(1, Math.floor(params.offset));
      if (params.lines) {
        const end = start + Math.floor(params.lines) - 1;
        cmd = `bat --plain --paging=never --color=never --line-range=${start}:${end} '${sq(p)}' 2>/dev/null || sed -n '${start},${end}p' '${sq(p)}'`;
      } else {
        cmd = `bat --plain --paging=never --color=never --line-range=${start}: '${sq(p)}' 2>/dev/null || sed -n '${start},$p' '${sq(p)}'`;
      }
    } else if (params.lines) {
      cmd = `head -${Math.abs(Math.floor(params.lines))} '${sq(p)}'`;
    } else {
      cmd = `printf '[file] %s lines, %s bytes\\n\\n' "$(wc -l < '${sq(p)}')" "$(wc -c < '${sq(p)}')"; bat --decorations=always --paging=never --color=never --style=numbers '${sq(p)}' 2>/dev/null || cat '${sq(p)}'`;
    }

    const result = await this.exec(cmd);
    return this.capOutput(`[source] ${argPath}\n\n` + result, argPath);
  }

  private async findImpl(params: FindParams): Promise<string> {
    const dir = params.source
      ? this.safePath(`/docs/${sq(params.source)}/`)
      : this.root + "/";
    const limit = params.maxResults ?? 30;
    return this.exec(
      `find '${dir}' -iname '${sq(params.pattern)}' -type f | head -${limit}`,
    );
  }

  private async grepImpl(params: GrepParams): Promise<string> {
    const ctx = Math.abs(Math.floor(params.context ?? 3));
    const argPath = this.resolvePath(params);
    const p = this.safePath(argPath);

    const [jsonResult, countResult] = await Promise.all([
      this.exec(`rg -i --json -C${ctx} '${sq(params.query)}' '${sq(p)}' | head -500`),
      this.exec(
        `rg -ic '${sq(params.query)}' '${sq(p)}' 2>/dev/null | awk -F: '{s+=$NF}END{print s+0}'`,
      ),
    ]);
    const total = parseInt(countResult) || 0;

    if (jsonResult) {
      const matches = parseRgJson(jsonResult);
      if (matches.length > 0) {
        const formatted = formatRgMatches(matches);
        const countNote =
          total > matches.length ? ` (showing ${matches.length} of ${total})` : "";
        return this.capOutput(
          `${matches.length}${countNote} matches\n\n${formatted}`,
          argPath,
        );
      }
    }

    const plainResult = await this.exec(
      `rg -in -C${ctx} '${sq(params.query)}' '${sq(p)}' | head -100`,
    );
    if (!plainResult.trim()) {
      return `[no matches for "${params.query}" in ${argPath}]`;
    }
    return this.capOutput(plainResult, argPath);
  }

  private async summaryImpl(params: SummaryParams): Promise<string> {
    const argPath = this.resolvePath(params);
    const p = this.safePath(argPath);
    const [headings, lineCount, byteCount] = await Promise.all([
      this.exec(`rg -n '^#' '${sq(p)}'`),
      this.exec(`wc -l < '${sq(p)}'`),
      this.exec(`wc -c < '${sq(p)}'`),
    ]);
    return `[source] ${argPath}\n\n${lineCount.trim()} lines, ${byteCount.trim()} bytes\n\n${headings}`;
  }

  private async sourcesImpl(params: SourcesParams): Promise<string> {
    const filterCmd = params.filter ? ` | rg -i '${sq(params.filter)}'` : "";
    // `cd` into the root so `find .` yields ./<source>/<file> and the
    // source dir is always awk field $2 - independent of root depth or
    // whether the root path is absolute or relative.
    return this.exec(
      `cd '${sq(this.root)}' && find . -mindepth 2 -type f 2>/dev/null | awk -F/ '{c[$2]++} END{for (d in c) printf "%s: %d files\\n", d, c[d]}' | sort${filterCmd}`,
    );
  }
}
