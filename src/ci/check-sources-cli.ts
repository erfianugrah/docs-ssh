/**
 * Runs the per-source health probe (src/ci/source-check.ts) and prints a
 * TSV report: name, status, method, count, ms, detail. Exits 1 when any
 * source fails, so CI goes red before the nightly build ships the breakage.
 *
 *   node --import tsx/esm src/ci/check-sources-cli.ts                 # all
 *   CHECK_ONLY=flyio,flyio-api node --import tsx/esm src/ci/check-sources-cli.ts
 *   CHECK_CHANGED_SINCE=origin/main ...   # only sources whose definition changed
 *
 * CHECK_CONCURRENCY (default 8), CHECK_TIMEOUT_S (default 300) per source.
 * CHECK_STRICT=1 also fails on warnings. Failures of sources listed in
 * TOLERATED_MISSING (src/ci/source-floors.ts) count as warnings.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SOURCES } from "../application/sources.js";
import { type CheckResult, checkSource } from "./source-check.js";
import { TOLERATED_MISSING } from "./source-floors.js";

const concurrency = Number(process.env.CHECK_CONCURRENCY ?? 8) || 8;
const timeoutMs = (Number(process.env.CHECK_TIMEOUT_S ?? 300) || 300) * 1000;
const strict = process.env.CHECK_STRICT === "1";

/** Source names whose sources.ts block differs from `ref` (working tree vs ref). */
function changedSince(ref: string): Set<string> {
  const diff = execFileSync("git", ["diff", "-U0", ref, "--", "src/application/sources.ts"], { encoding: "utf-8" });
  const current = readFileSync("src/application/sources.ts", "utf-8").split("\n");
  const names = new Set<string>();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]);
    // Attribute each changed line to the nearest `name:` at or above it,
    // and also below it (a change in a block's leading comment).
    // simplify: line heuristic over-selects a neighbouring block now and
    // then (extra probes, never a missed one); parse the AST if it matters.
    for (let line = Math.max(1, start); line <= start + Math.max(len, 1) - 1; line++) {
      for (let i = line - 1; i >= 0; i--) {
        const n = current[i]?.match(/^\s+name: "([^"]+)"/);
        if (n) {
          names.add(n[1]);
          break;
        }
        if (/^\s+new DocSource\(\{/.test(current[i] ?? "") && i < line - 1) break;
      }
      for (let i = line - 1; i < Math.min(current.length, line + 15); i++) {
        const n = current[i]?.match(/^\s+name: "([^"]+)"/);
        if (n) {
          names.add(n[1]);
          break;
        }
      }
    }
  }
  return names;
}

let sources = SOURCES;
const only = (process.env.CHECK_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (only.length > 0) {
  sources = SOURCES.filter((s) => only.includes(s.name));
} else if (process.env.CHECK_CHANGED_SINCE) {
  const changed = changedSince(process.env.CHECK_CHANGED_SINCE);
  sources = SOURCES.filter((s) => changed.has(s.name));
  console.error(`changed since ${process.env.CHECK_CHANGED_SINCE}: ${[...changed].join(", ") || "(none)"}`);
}
if (sources.length === 0) {
  console.error("no sources to check");
  process.exit(0);
}

const results: CheckResult[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < sources.length) {
    const s = sources[next++];
    const r = await checkSource(s, timeoutMs);
    // A known upstream block (src/ci/source-floors.ts) stays visible but
    // does not turn every run red.
    if (r.status === "fail" && TOLERATED_MISSING[r.name]) {
      r.status = "warn";
      r.detail = `tolerated (${TOLERATED_MISSING[r.name]}): ${r.detail}`;
    }
    results.push(r);
    const mark = r.status === "ok" ? "ok  " : r.status === "warn" ? "WARN" : "FAIL";
    console.error(`[${results.length}/${sources.length}] ${mark} ${r.name} (${(r.ms / 1000).toFixed(1)}s) ${r.detail}`);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));

const order: Record<string, number> = { fail: 0, warn: 1, ok: 2 };
results.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
console.log(["name", "status", "method", "count", "ms", "detail"].join("\t"));
for (const r of results) {
  console.log([r.name, r.status, r.method, r.count ?? "", r.ms, r.detail.replace(/\s+/g, " ")].join("\t"));
}
const fails = results.filter((r) => r.status === "fail");
const warns = results.filter((r) => r.status === "warn");
console.error(`\n${results.length} checked: ${results.length - fails.length - warns.length} ok, ${warns.length} warn, ${fails.length} fail`);
for (const r of fails) console.error(`  FAIL ${r.name}: ${r.detail}`);
process.exit(fails.length > 0 || (strict && warns.length > 0) ? 1 : 0);
