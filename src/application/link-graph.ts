import * as fs from "node:fs/promises";
import * as path from "node:path";

export const LINKS_FILENAME = "_links.tsv";

// Inline link targets in document order; titles/angle brackets stripped.
// Images and fenced-code content excluded.
export function extractLinks(markdown: string): string[] {
  const links: string[] = [];
  const fenceRe = /^\s*(```|~~~)/;
  const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  let inFence = false;
  let fenceChar = "";
  for (const line of markdown.split("\n")) {
    const fence = line.match(fenceRe);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1];
      } else if (fence[1] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(linkRe)) {
      const idx = m.index ?? 0;
      if (line[idx - 1] === "!") continue; // image
      let target = m[2].trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1).trim();
      } else {
        // non-< > form has no spaces in the href; a title trails it
        target = target.split(/\s+/)[0];
      }
      if (target) links.push(target);
    }
  }
  return links;
}

export function normaliseUrl(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  let p = u.pathname;
  p = p.replace(/\/index\.(html|htm|md)$/, "");
  p = p.replace(/\.(html|htm|md|mdx)$/, "");
  p = p.replace(/\/$/, "");
  return `https://${u.host}${p}`;
}

function keyOf(p: string): string {
  p = p.replace(/\.(md|mdx|html|htm)$/, "");
  p = p.replace(/\/index$/, "");
  p = p.replace(/\/_index$/, "");
  p = p.replace(/^\/+|\/+$/g, "");
  return p;
}

// Page-relative href: join against the page's dir within its source, refusing
// to escape the source root.
function candidatePath(rel: string, href: string): string | undefined {
  if (href.startsWith("/")) return href;
  if (/^https?:\/\//i.test(href)) return undefined;
  const stack = rel.split("/").slice(0, -1).filter(Boolean);
  for (const part of href.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return undefined;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

// Shared resolution rules: origin lookup first (absolute URLs resolve only
// through it), then per-source path-suffix index.
function makeResolver(
  pagePaths: ReadonlyArray<string>,
  origins: ReadonlyMap<string, string>,
): (pagePath: string, links: readonly string[]) => string[] {
  // Reverse origin map: a URL shared by 3+ files is bulk; 2 -> smallest wins.
  const byUrl = new Map<string, string[]>();
  for (const [p, url] of origins) {
    const n = normaliseUrl(url);
    if (!n) continue;
    const arr = byUrl.get(n) ?? [];
    arr.push(p);
    byUrl.set(n, arr);
  }
  const originToPath = new Map<string, string>();
  for (const [n, arr] of byUrl) {
    if (arr.length >= 3) continue;
    originToPath.set(n, arr.length === 2 ? [...arr].sort()[0] : arr[0]);
  }

  // Index every page of a source by the key of its rel path (smallest wins).
  const indexBySource = new Map<string, Map<string, string>>();
  for (const pagePath of pagePaths) {
    const [source, ...rest] = pagePath.split("/");
    const key = keyOf(rest.join("/"));
    let idx = indexBySource.get(source);
    if (!idx) {
      idx = new Map();
      indexBySource.set(source, idx);
    }
    if (!idx.has(key) || pagePath < idx.get(key)!) idx.set(key, pagePath);
  }

  return function resolve(pagePath: string, links: readonly string[]): string[] {
    const [source, ...rest] = pagePath.split("/");
    const rel = rest.join("/");
    const idx = indexBySource.get(source);
    const origin = origins.get(pagePath);
    const out: string[] = [];
    for (const raw of links) {
      if (
        raw.startsWith("#") ||
        raw.startsWith("mailto:") ||
        raw.startsWith("javascript:") ||
        raw.startsWith("data:")
      ) {
        continue;
      }
      const href = raw.split("#")[0].split("?")[0];
      if (!href) continue;
      let target: string | undefined;
      if (origin) {
        let abs: string;
        try {
          abs = new URL(href, origin).href;
        } catch {
          abs = href;
        }
        target = originToPath.get(normaliseUrl(abs) ?? "");
      }
      if (target && target !== pagePath) {
        out.push(target);
        continue;
      }
      if (!idx) continue;
      const candidate = candidatePath(rel, href);
      if (candidate === undefined) continue;
      const segs = keyOf(candidate).split("/").filter(Boolean);
      let found: string | undefined;
      for (let start = 0; start < segs.length; start++) {
        const suffix = segs.slice(start).join("/");
        found = idx.get(suffix);
        if (found) break;
        if (segs.length - start === 2) break; // don't drop to a single segment
      }
      if (found && found !== pagePath) out.push(found);
    }
    return out;
  };
}

// Navigation-hub filter: in a 20+ page source, drop targets linked from
// more than half of that source's pages.
function hubFilter(
  edgeSet: ReadonlySet<string>,
  pagePaths: ReadonlyArray<string>,
): Array<[string, string]> {
  const pagesPerSource = new Map<string, number>();
  for (const p of pagePaths) {
    const [s] = p.split("/");
    pagesPerSource.set(s, (pagesPerSource.get(s) ?? 0) + 1);
  }
  const linkersByTarget = new Map<string, Set<string>>();
  for (const e of edgeSet) {
    const [from, to] = e.split("\t");
    const [fs] = from.split("/");
    const [ts] = to.split("/");
    if (fs === ts) {
      const k = `${ts}\u0000${to}`;
      let set = linkersByTarget.get(k);
      if (!set) {
        set = new Set();
        linkersByTarget.set(k, set);
      }
      set.add(from);
    }
  }
  const filtered: string[] = [];
  for (const e of edgeSet) {
    const [from, to] = e.split("\t");
    const [ts] = to.split("/");
    const total = pagesPerSource.get(ts) ?? 0;
    const linkers = linkersByTarget.get(`${ts}\u0000${to}`)?.size ?? 0;
    if (total >= 20 && 2 * linkers > total) continue;
    filtered.push(e);
  }
  return filtered
    .sort()
    .map((e) => {
      const [from, to] = e.split("\t");
      return [from, to] as [string, string];
    });
}

export function buildLinkGraph(
  pages: ReadonlyArray<{ path: string; links: readonly string[] }>,
  origins: ReadonlyMap<string, string>,
): Array<[string, string]> {
  const resolve = makeResolver(
    pages.map((p) => p.path),
    origins,
  );
  const edgeSet = new Set<string>();
  for (const page of pages) {
    for (const target of resolve(page.path, page.links)) {
      edgeSet.add(`${page.path}\t${target}`);
    }
  }
  return hubFilter(edgeSet, pages.map((p) => p.path));
}

async function collectMd(root: string, dir: string, out: { path: string; rel: string }[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectMd(root, full, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push({ path: full, rel: path.relative(root, full) });
    }
  }
}

export async function writeLinksTsv(outDir: string): Promise<number> {
  const origins = new Map<string, string>();
  const originsPath = path.join(outDir, "_origins.tsv");
  try {
    const text = await fs.readFile(originsPath, "utf-8");
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      origins.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // no origins file - fine
  }

  // Pass 1: page paths only (for the resolver); full paths kept for reading.
  const files: { source: string; full: string; pagePath: string }[] = [];
  const top = await fs.readdir(outDir, { withFileTypes: true });
  for (const e of top) {
    if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const list: { path: string; rel: string }[] = [];
    const srcDir = path.join(outDir, e.name);
    await collectMd(srcDir, srcDir, list);
    for (const f of list) {
      files.push({
        source: e.name,
        full: f.path,
        pagePath: `${e.name}/${f.rel.split(path.sep).join("/")}`,
      });
    }
  }

  const resolve = makeResolver(
    files.map((f) => f.pagePath),
    origins,
  );

  // Pass 2: read one file at a time; links are resolved and dropped
  // immediately, only the edges survive.
  const edgeSet = new Set<string>();
  for (const f of files) {
    const content = await fs.readFile(f.full, "utf-8");
    for (const target of resolve(f.pagePath, extractLinks(content))) {
      edgeSet.add(`${f.pagePath}\t${target}`);
    }
  }

  const edges = hubFilter(edgeSet, files.map((f) => f.pagePath));
  const body = edges.map(([from, to]) => `${from}\t${to}\n`).join("");
  await fs.writeFile(path.join(outDir, LINKS_FILENAME), body);
  return edges.length;
}
