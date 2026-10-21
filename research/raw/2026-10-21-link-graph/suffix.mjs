import fs from "node:fs"; import path from "node:path";
const root = "/tmp/dg";
const linkRe = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HOST = { cloudflare: "developers.cloudflare.com", supabase: "supabase.com/docs", kubernetes: "kubernetes.io/docs", postgres: "postgresql.org/docs" };
const key = (p) => p.replace(/\.(md|mdx|html?)$/, "").replace(/\/(_?index)$/, "").replace(/\/$/, "");
for (const src of ["postgres", "supabase", "cloudflare", "kubernetes", "caddy"]) {
  const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : f.endsWith(".md") && files.push(f); } }; walk(`${root}/${src}`);
  const idx = new Map(); for (const f of files) idx.set(key(path.relative(`${root}/${src}`, f)), f);
  let local = 0, hit = 0; const linked = new Set(), targets = new Set(); const misses = [];
  for (const f of files) {
    const dir = path.dirname(path.relative(`${root}/${src}`, f));
    for (const m of fs.readFileSync(f, "utf8").matchAll(linkRe)) {
      const href = m[1]; if (/^(mailto:|#)/.test(href)) continue; if (/^https?:/.test(href)) { if (!HOST[src] || !href.includes(HOST[src])) continue; }
      local++;
      let p = href.replace(/^https?:\/\/[^/]+/, "").split("#")[0].split("?")[0]; if (!p) continue;
      p = p.startsWith("/") ? p.slice(1) : path.normalize(path.join(dir, p));
      const segs = key(p).split("/").filter(Boolean); let t;
      for (let i = 0; i < segs.length && !t; i++) t = idx.get(segs.slice(i).join("/"));
      if (t && t !== f) { hit++; linked.add(f); targets.add(t); } else if (!t && misses.length < 3) misses.push(href);
    }
  }
  console.log(`${src}: local links=${local} matched=${hit} (${(100*hit/Math.max(local,1)).toFixed(0)}%) files with edge=${linked.size}/${files.length} targets=${targets.size} | miss e.g. ${misses.join("  ")}`);
}
