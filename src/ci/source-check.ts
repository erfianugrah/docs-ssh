/**
 * Cheap per-source health probe: does each source's discovery path still
 * yield in-scope content, without a full fetch? Exercises the same code the
 * fetcher uses (discover(), the llms-full splitter, the OpenAPI converter)
 * so a pass here means the real fetch has something to work with.
 *
 *   git      clone --depth 1 --filter=blob:none --no-checkout, then count
 *            files under `paths` with ls-tree (trees only, no blobs)
 *   rsync    rsync --list-only on the module
 *   http     bulk methods (llms-full, openapi, tarball, texinfo): GET the
 *            discovery URL and, where cheap, split/convert it and count;
 *            URL methods (sitemap, toc, llms-txt, rss, mediawiki, dokuwiki):
 *            run discovery, apply urlPattern/urlExclude, count, then fetch
 *            a few sample pages
 *
 * fail = the fetch would produce nothing or error (dead URL, 0 in-scope
 * URLs, repo gone, empty paths). warn = degraded but usable (some sample
 * pages fail, discovery redirects to another host, probe timed out).
 * Catches the 2026-10-05 class of breakage (flyio moved hosts, a spec URL
 * 404ing, a repo going private) before the nightly build hits it.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type { DocSource } from "../domain/DocSource.js";
import { discover } from "../ingestors/discovery/index.js";
import { applyUrlSuffix } from "../ingestors/HttpIngestor.js";
import { UA } from "../ingestors/http-client.js";
import { splitLlmsFull } from "../ingestors/llms-splitter.js";
import { convertOpenApiToMarkdown } from "../ingestors/openapi-converter.js";

const execFileAsync = promisify(execFile);

/** "tolerated" is assigned by the CLI for TOLERATED_MISSING sources. */
export type CheckStatus = "ok" | "warn" | "fail" | "tolerated";

export interface CheckResult {
  name: string;
  /** git | rsync | http:<discovery> */
  method: string;
  status: CheckStatus;
  /** In-scope files/URLs/pages found, when the probe can count them. */
  count?: number;
  detail: string;
  ms: number;
}

const HTTP_TIMEOUT = 30_000;
const BULK_TIMEOUT = 120_000;
const SAMPLE_PAGES = 3;

/** Host of a URL, or "" when unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Applies a source's include/exclude/suffix rules the way HttpIngestor does. */
export function filterUrls(source: DocSource, urls: readonly string[]): string[] {
  let out = [...urls];
  if (source.urlPattern) {
    const re = new RegExp(source.urlPattern);
    out = out.filter((u) => re.test(u));
  }
  if (source.urlExclude) {
    const re = new RegExp(source.urlExclude);
    out = out.filter((u) => !re.test(u));
  }
  if (source.urlSuffix) out = out.map((u) => applyUrlSuffix(u, source.urlSuffix!));
  return [...new Set(out)];
}

/** Evenly spaced picks so samples span the URL list, not just its head. */
export function pickSamples<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  const step = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

/**
 * GET with one retry after 5s on a network-level error (refused, reset,
 * DNS) or a 429. Other HTTP error statuses are returned, not retried: those
 * are the signal. archive.org refuses and 429s bursts briefly.
 */
/**
 * Hosts shared by several sources get their requests serialised so the
 * daily all-source probe does not burst them: four sources pin
 * web.archive.org captures, and archive.org 429s concurrent hits.
 */
const SERIAL_HOSTS = new Set(["web.archive.org"]);
const hostQueues = new Map<string, Promise<unknown>>();

function serialised<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  if (!SERIAL_HOSTS.has(host)) return fn();
  const prev = hostQueues.get(host) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  hostQueues.set(host, next);
  return next;
}

async function get(url: string, source: DocSource, timeout = HTTP_TIMEOUT): Promise<Response> {
  return serialised(url, () => getOnce(url, source, timeout));
}

async function getOnce(url: string, source: DocSource, timeout: number): Promise<Response> {
  const once = () =>
    fetch(url, {
      headers: { "User-Agent": source.userAgent ?? UA },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
  try {
    const res = await once();
    if (res.status !== 429) return res;
    await res.body?.cancel();
  } catch {
    // network error: fall through to the single retry
  }
  await new Promise((r) => setTimeout(r, SERIAL_HOSTS.has(hostOf(url)) ? 15_000 : 5_000));
  return once();
}

function redirectNote(requested: string, res: Response): string {
  const from = hostOf(requested);
  const to = hostOf(res.url || requested);
  return to && from && to !== from ? `redirects to ${to}` : "";
}

async function checkGit(source: DocSource): Promise<Omit<CheckResult, "name" | "ms">> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "srccheck-"));
  // A deleted or private GitHub repo answers with an auth prompt; with no
  // TTY that hangs or fails slowly. Fail fast instead.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" };
  try {
    await execFileAsync(
      "git",
      ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout", source.url, dir],
      { env, timeout: 180_000, maxBuffer: 16 << 20 },
    );
    const paths = source.paths.length > 0 ? [...source.paths] : ["."];
    const { stdout } = await execFileAsync("git", ["-C", dir, "ls-tree", "-r", "--name-only", "HEAD", "--", ...paths], {
      env,
      timeout: 60_000,
      maxBuffer: 256 << 20,
    });
    const files = stdout.split("\n").filter(Boolean);
    const missing = paths.filter((p) => p !== "." && !files.some((f) => f === p || f.startsWith(p.replace(/\/$/, "") + "/")));
    if (files.length === 0) {
      return { method: "git", status: "fail", count: 0, detail: `no files under ${paths.join(", ")}` };
    }
    if (missing.length > 0) {
      return { method: "git", status: "warn", count: files.length, detail: `paths gone: ${missing.join(", ")}` };
    }
    return { method: "git", status: "ok", count: files.length, detail: `${files.length} files` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = msg.split("\n").find((l) => /fatal|error|timed out|killed/i.test(l)) ?? msg.split("\n")[0];
    return { method: "git", status: "fail", detail: line.trim().slice(0, 200) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function checkRsync(source: DocSource): Promise<Omit<CheckResult, "name" | "ms">> {
  try {
    const { stdout } = await execFileAsync("rsync", ["--list-only", "--no-motd", `${source.url}/`], {
      timeout: 120_000,
      maxBuffer: 64 << 20,
    });
    const entries = stdout.split("\n").filter((l) => l.trim() && !/\s\.$/.test(l));
    if (entries.length === 0) return { method: "rsync", status: "fail", count: 0, detail: "module lists no files" };
    return { method: "rsync", status: "ok", count: entries.length, detail: `${entries.length} entries` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(msg)) return { method: "rsync", status: "warn", detail: "rsync not installed on this host" };
    return { method: "rsync", status: "fail", detail: msg.split("\n")[0].slice(0, 200) };
  }
}

async function checkBulk(source: DocSource, method: string): Promise<Omit<CheckResult, "name" | "ms">> {
  const url = source.discoveryUrl!;
  const res = await get(url, source, BULK_TIMEOUT);
  if (!res.ok) {
    await res.body?.cancel();
    if (source.fallbackDiscoveryUrl) {
      const fb = await get(source.fallbackDiscoveryUrl, source, BULK_TIMEOUT);
      await fb.body?.cancel();
      // A configured fallback mirror working is the designed path (mysql:
      // Oracle's CDN 403s our IPs), not degradation.
      if (fb.ok) return { method, status: "ok", detail: `primary HTTP ${res.status}, fallback mirror ok` };
    }
    return { method, status: "fail", detail: `HTTP ${res.status} for ${url}` };
  }
  const note = redirectNote(url, res);
  const ctype = res.headers.get("content-type") ?? "";
  if (source.discovery === "llms-full") {
    const pages = splitLlmsFull(await res.text(), source.url);
    let count = 0;
    for (const p of pages.keys()) {
      if (source.urlPattern && !new RegExp(source.urlPattern).test(p)) continue;
      if (source.urlExclude && new RegExp(source.urlExclude).test(p)) continue;
      count++;
    }
    if (count === 0) return { method, status: "fail", count, detail: "llms-full split into 0 in-scope pages" };
    return { method, status: note ? "warn" : "ok", count, detail: [`${count} pages`, note].filter(Boolean).join("; ") };
  }
  if (source.discovery === "openapi") {
    const text = await res.text();
    let count = 0;
    try {
      count = convertOpenApiToMarkdown(text, source.name).length;
    } catch (err) {
      return { method, status: "fail", detail: `spec does not convert: ${String(err).slice(0, 150)}` };
    }
    if (count === 0) return { method, status: "fail", count, detail: "spec converted to 0 files" };
    return { method, status: note ? "warn" : "ok", count, detail: [`${count} files`, note].filter(Boolean).join("; ") };
  }
  // tarball / texinfo: existence and type only, the archive can be large.
  await res.body?.cancel();
  if (ctype.includes("text/html")) {
    return { method, status: "fail", detail: `got an HTML page (${ctype}), expected an archive` };
  }
  return { method, status: note ? "warn" : "ok", detail: [`HTTP 200 ${ctype}`.trim(), note].filter(Boolean).join("; ") };
}

async function checkPages(source: DocSource, method: string, urls: string[]): Promise<Omit<CheckResult, "name" | "ms">> {
  const samples = pickSamples(urls, SAMPLE_PAGES);
  const failures: string[] = [];
  const throttled: string[] = [];
  const redirects = new Set<string>();
  await Promise.all(
    samples.map(async (u) => {
      try {
        const res = await get(u, source);
        await res.body?.cancel();
        // A 429 from a SERIAL_HOSTS archive after the retry is the shared
        // host rate-limiting the probe, not drift in the source (CI saw
        // web.archive.org 429 a pinned capture that fetches fine).
        if (res.status === 429 && SERIAL_HOSTS.has(hostOf(u))) throttled.push(u);
        else if (!res.ok) failures.push(`HTTP ${res.status} ${u}`);
        const note = redirectNote(u, res);
        if (note && !source.expectRedirects) redirects.add(note);
      } catch (err) {
        failures.push(`${err instanceof Error ? err.message : String(err)} ${u}`.slice(0, 160));
      }
    }),
  );
  const notes = [`${urls.length} URLs`, ...redirects];
  if (throttled.length > 0) notes.push(`${throttled.length} sample(s) rate-limited by ${hostOf(throttled[0])}, not counted`);
  if (failures.length > 0 && failures.length === samples.length - throttled.length) {
    return { method, status: "fail", count: urls.length, detail: `all ${samples.length} sample pages failed: ${failures[0]}` };
  }
  if (failures.length > 0) {
    notes.push(`${failures.length}/${samples.length} samples failed: ${failures[0]}`);
    return { method, status: "warn", count: urls.length, detail: notes.join("; ") };
  }
  return { method, status: redirects.size > 0 ? "warn" : "ok", count: urls.length, detail: notes.join("; ") };
}

async function checkHttp(source: DocSource): Promise<Omit<CheckResult, "name" | "ms">> {
  const method = `http:${source.discovery}`;
  if (["llms-full", "openapi", "tarball", "texinfo"].includes(source.discovery) && source.discoveryUrl) {
    return checkBulk(source, method);
  }
  if (source.discovery === "statuspage") {
    const url = `${source.url.replace(/\/$/, "")}/history.json`;
    const res = await get(url, source);
    await res.body?.cancel();
    return res.ok
      ? { method, status: "ok", detail: "history.json reachable" }
      : { method, status: "fail", detail: `HTTP ${res.status} for ${url}` };
  }
  let urls: string[];
  if (source.urls.length > 0) {
    urls = [...source.urls];
  } else if (source.discovery !== "none" && source.discoveryUrl) {
    urls = await discover(source);
    if (urls.length === 0) return { method, status: "fail", count: 0, detail: `discovery returned 0 URLs (${source.discoveryUrl})` };
  } else {
    urls = [source.url];
  }
  const filtered = filterUrls(source, urls);
  if (filtered.length === 0) {
    return { method, status: "fail", count: 0, detail: `${urls.length} discovered, 0 left after urlPattern/urlExclude` };
  }
  return checkPages(source, method, filtered);
}

/** Probes one source; never throws. `timeoutMs` bounds the whole probe. */
export async function checkSource(source: DocSource, timeoutMs = 300_000): Promise<CheckResult> {
  const t0 = Date.now();
  const probe =
    source.type === "git" ? checkGit(source) : source.type === "rsync" ? checkRsync(source) : checkHttp(source);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Omit<CheckResult, "name" | "ms">>((resolve) => {
    timer = setTimeout(
      () => resolve({ method: source.type, status: "warn", detail: `probe timed out after ${timeoutMs / 1000}s` }),
      timeoutMs,
    );
  });
  try {
    const r = await Promise.race([probe, timeout]);
    return { name: source.name, ...r, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}${err.cause ? ` (${String(err.cause)})` : ""}` : String(err);
    return { name: source.name, method: source.type, status: "fail", detail: msg.slice(0, 200), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
