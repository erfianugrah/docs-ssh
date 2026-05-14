/**
 * Microbenchmark: measure the CPU saving from skipping Pass 1
 * (HtmlNormaliser → Turndown) on pre-normalised DocFiles.
 *
 * Approach: feed the same realistic HTML payload N times through the
 * normalise pipeline, once with preNormalised=false (Turndown runs)
 * and once with preNormalised=true (Pass 1 skipped). Compare wall
 * times. Multiple iterations to smooth out V8 JIT warmup.
 *
 * Run: pnpm tsx scripts/bench-normaliser-skip.ts
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DocFile } from "../src/domain/DocFile.js";
import { DocSet } from "../src/domain/DocSet.js";
import { DocSource } from "../src/domain/DocSource.js";
import { UpdateDocSets } from "../src/application/UpdateDocSets.js";
import { MdxNormaliser } from "../src/normaliser/MdxNormaliser.js";
import { HtmlNormaliser } from "../src/normaliser/HtmlNormaliser.js";
import { MarkdownCleaner } from "../src/normaliser/MarkdownCleaner.js";
import { ContentSanitiser } from "../src/normaliser/ContentSanitiser.js";

// Realistic blog-post HTML ~6KB. Headings, code, links, lists.
const HTML_BODY = `<!DOCTYPE html>
<html><head><title>Sandboxing AI agents | Cloudflare Blog</title></head><body>
<nav><a href="/">Home</a> &gt; <a href="/blog/">Blog</a></nav>
<header><h1>Cloudflare Blog</h1></header>
<main><article>
<h1>Sandboxing AI agents, 100x faster</h1>
<p>We're introducing Dynamic Workers, which allow you to execute AI-generated code in secure, lightweight isolates. By using V8 instead of containers, we can spawn a new sandbox in <strong>under 5 milliseconds</strong>.</p>
<h2>How it works</h2>
<p>The Workers platform uses V8 isolates. Isolates are <strong>far more lightweight</strong> than containers because they share a single process, avoiding the overhead of OS-level isolation.</p>
<pre><code>const worker = env.LOADER.get(id);
const result = await worker.fetch(request);
return result;</code></pre>
<h3>Trade-offs</h3>
<p>This approach has some constraints:</p>
<ul>
<li>No native binaries — V8 can only run JavaScript and WebAssembly.</li>
<li>Memory limits — each isolate gets a fraction of the worker pool.</li>
<li>API restrictions — no filesystem, no spawning processes, no raw sockets.</li>
</ul>
<h2>Why this matters for AI</h2>
<p>AI agents often need to execute code to solve problems. Traditional approaches use full VMs or containers, which take seconds to spin up. With Dynamic Workers, each tool call gets its own fresh isolate in milliseconds.</p>
<p>This unlocks new patterns:</p>
<ol>
<li>Per-request code execution without infrastructure overhead.</li>
<li>Cheap multi-tenant code-running APIs.</li>
<li>Safe execution of model-generated code without trusting the model.</li>
</ol>
<h3>Benchmark numbers</h3>
<p>We measured the following on production traffic:</p>
<table>
<tr><th>Operation</th><th>Cold start</th><th>Warm start</th></tr>
<tr><td>Dynamic Worker</td><td>5ms</td><td>0.5ms</td></tr>
<tr><td>Container</td><td>500ms</td><td>50ms</td></tr>
<tr><td>VM</td><td>2000ms</td><td>500ms</td></tr>
</table>
<p>The numbers speak for themselves. Dynamic Workers are <em>two to three orders of magnitude</em> faster.</p>
<h2>What's next</h2>
<p>We're rolling this out to all Workers customers starting today. Try it with <code>wrangler dev --experimental-dynamic-workers</code> and let us know what you build.</p>
<p>Read more on the <a href="/docs/workers/dynamic">Dynamic Workers documentation</a>.</p>
</article></main>
<footer><p>Copyright 2026 Cloudflare</p></footer>
<script>analytics();</script>
</body></html>`;

// Realistic markdown body (same logical content)
const MD_BODY = `---
title: Sandboxing AI agents, 100x faster
description: Dynamic Workers spawn V8 isolates in under 5ms.
---

# Sandboxing AI agents, 100x faster

We're introducing Dynamic Workers, which allow you to execute AI-generated code in secure, lightweight isolates. By using V8 instead of containers, we can spawn a new sandbox in **under 5 milliseconds**.

## How it works

The Workers platform uses V8 isolates. Isolates are **far more lightweight** than containers because they share a single process, avoiding the overhead of OS-level isolation.

\`\`\`js
const worker = env.LOADER.get(id);
const result = await worker.fetch(request);
return result;
\`\`\`

### Trade-offs

This approach has some constraints:

- No native binaries — V8 can only run JavaScript and WebAssembly.
- Memory limits — each isolate gets a fraction of the worker pool.
- API restrictions — no filesystem, no spawning processes, no raw sockets.

## Why this matters for AI

AI agents often need to execute code to solve problems. Traditional approaches use full VMs or containers, which take seconds to spin up. With Dynamic Workers, each tool call gets its own fresh isolate in milliseconds.

This unlocks new patterns:

1. Per-request code execution without infrastructure overhead.
2. Cheap multi-tenant code-running APIs.
3. Safe execution of model-generated code without trusting the model.

### Benchmark numbers

We measured the following on production traffic:

| Operation | Cold start | Warm start |
| --- | --- | --- |
| Dynamic Worker | 5ms | 0.5ms |
| Container | 500ms | 50ms |
| VM | 2000ms | 500ms |

The numbers speak for themselves. Dynamic Workers are *two to three orders of magnitude* faster.

## What's next

We're rolling this out to all Workers customers starting today. Try it with \`wrangler dev --experimental-dynamic-workers\` and let us know what you build.

Read more on the [Dynamic Workers documentation](/docs/workers/dynamic).`;

const FILES_PER_RUN = 200;
const ITERATIONS = 5;

const source = new DocSource({
  name: "bench-source",
  type: "http",
  url: "https://example.com/",
  format: "html",
});

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bench-norm-"));

const normalisers = [
  new MdxNormaliser(),
  new HtmlNormaliser(),
  new MarkdownCleaner(),
  new ContentSanitiser(),
];

const updater = new UpdateDocSets({
  sources: [source],
  ingestors: [],
  normalisers,
  outDir: tmpDir,
  workDir: tmpDir,
});

function buildSet(preNormalised: boolean): DocSet {
  const files = new Map<string, DocFile>();
  const body = preNormalised ? MD_BODY : HTML_BODY;
  for (let i = 0; i < FILES_PER_RUN; i++) {
    files.set(
      `post-${i}.md`,
      new DocFile(`post-${i}.md`, body, { preNormalised }),
    );
  }
  return new DocSet(source, files);
}

async function runOne(preNormalised: boolean): Promise<number> {
  const set = buildSet(preNormalised);
  const t0 = process.hrtime.bigint();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (updater as any).normalise(set);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1_000_000; // ms
}

console.log(
  `\nBenchmark: ${FILES_PER_RUN} files × ${ITERATIONS} iterations each\n`,
);

// Warm-up runs to settle JIT
await runOne(false);
await runOne(true);

const turndownTimes: number[] = [];
const skipTimes: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  const a = await runOne(false);
  const b = await runOne(true);
  turndownTimes.push(a);
  skipTimes.push(b);
  console.log(
    `  iter ${i + 1}:  Turndown=${a.toFixed(1)}ms  Skip=${b.toFixed(1)}ms  ratio=${(a / b).toFixed(2)}×`,
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const tdMean = mean(turndownTimes);
const skipMean = mean(skipTimes);

console.log(`\nMean Turndown:    ${tdMean.toFixed(1)}ms (${(tdMean / FILES_PER_RUN).toFixed(2)}ms/file)`);
console.log(`Mean Pass 1 skip: ${skipMean.toFixed(1)}ms (${(skipMean / FILES_PER_RUN).toFixed(2)}ms/file)`);
console.log(`Speedup:          ${(tdMean / skipMean).toFixed(1)}×`);
console.log(`CPU saved/file:   ${((tdMean - skipMean) / FILES_PER_RUN).toFixed(2)}ms`);

await fs.rm(tmpDir, { recursive: true });
process.exit(0);
