/**
 * Quick microbenchmark: confirm the looksLikeHtml() body-sniff has
 * negligible cost on real-world markdown bodies.
 *
 * Run: pnpm tsx scripts/bench-body-sniff.ts
 */
function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 200).toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body")
  );
}

// Realistic 6KB markdown body
const MD =
  "---\n" +
  "title: Sandboxing AI agents\n" +
  "description: How we made V8 isolates 100x faster.\n" +
  "---\n\n" +
  "# Sandboxing AI agents, 100x faster\n\n" +
  "We're introducing Dynamic Workers.\n\n".repeat(100);

const HTML = "<!doctype html>\n<html><body>" + "<p>page</p>".repeat(500) + "</body></html>";

const HTML_LEADING_WS = "  \n\n  " + HTML;

const ITERS = 100_000;

function bench(name: string, body: string): void {
  // warm up
  for (let i = 0; i < 1000; i++) looksLikeHtml(body);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < ITERS; i++) looksLikeHtml(body);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  const nsPerCall = (Number(t1 - t0) / ITERS).toFixed(0);
  console.log(`  ${name.padEnd(35)} ${ms.toFixed(0)}ms total, ${nsPerCall}ns/call`);
}

console.log(`\n${ITERS.toLocaleString()} iterations per case:\n`);
bench("markdown body (6KB)", MD);
bench("HTML body (5KB)", HTML);
bench("HTML body with leading whitespace", HTML_LEADING_WS);
bench("empty string", "");

// Sanity check results
console.log(`\nSanity:`);
console.log(`  markdown → ${looksLikeHtml(MD)} (expect false)`);
console.log(`  html     → ${looksLikeHtml(HTML)} (expect true)`);
console.log(`  ws+html  → ${looksLikeHtml(HTML_LEADING_WS)} (expect true)`);
console.log(`  empty    → ${looksLikeHtml("")} (expect false)`);
