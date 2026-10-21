import fs from "node:fs"; import path from "node:path";
const root = "/tmp/dg";
const norm = (u) => { try { const x = new URL(u); x.hash = ""; x.search = ""; let s = x.href.replace(/\/$/, "").replace(/\/index\.html?$/, "").replace(/\.html?$/, "").replace(/\.md$/, ""); return s.replace(/^http:/, "https:"); } catch { return null; } };
const fwd = new Map(), rev = new Map();
for (const line of fs.readFileSync(`${root}/_origins.tsv`, "utf8").split("\n")) { const [p, u] = line.split("\t"); if (!p || !u) continue; fwd.set(p, u); const n = norm(u); if (n && !rev.has(n)) rev.set(n, p); }
const linkRe = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const src of ["postgres", "supabase", "cloudflare", "kubernetes", "caddy"]) {
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : f.endsWith(".md") && files.push(f); } }; walk(`${root}/${src}`);
  let total = 0, anchor = 0, noBase = 0, sameSrc = 0, crossSrc = 0, external = 0; const targets = new Set(), linkedFiles = new Set(); const cross = {};
  for (const f of files) {
    const rel = path.relative(root, f); const base = fwd.get(rel); const txt = fs.readFileSync(f, "utf8");
    for (const m of txt.matchAll(linkRe)) {
      total++; const href = m[1]; if (href.startsWith("#")) { anchor++; continue; }
      let abs; try { abs = new URL(href, base ?? undefined).href; } catch { noBase++; continue; }
      const hit = rev.get(norm(abs));
      if (!hit) { external++; continue; }
      if (hit === rel) { anchor++; continue; }
      const hs = hit.split("/")[0]; if (hs === src) sameSrc++; else { crossSrc++; cross[hs] = (cross[hs] ?? 0) + 1; }
      targets.add(hit); linkedFiles.add(rel);
    }
  }
  const top = Object.entries(cross).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${src}: files=${files.length} links=${total} anchor/self=${anchor} unresolvable(no base)=${noBase} -> resolved same-source=${sameSrc} cross-source=${crossSrc} other/external=${external} | files with >=1 resolved edge=${linkedFiles.size} distinct targets=${targets.size} | cross: ${top}`);
}
