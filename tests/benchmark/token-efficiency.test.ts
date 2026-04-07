import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Token efficiency benchmark.
 *
 * Measures bytes returned by different retrieval strategies for the same
 * information need. Lower bytes = fewer tokens = cheaper and faster.
 *
 * Strategies:
 *   1. "grep -rl" (search)     — returns file paths only
 *   2. "head -N"  (skim)       — first N lines of the target file
 *   3. "grep -A"  (context)    — matching lines with surrounding context
 *   4. "cat"      (full)       — entire file content
 *
 * Each strategy is tested against docs.erfi.io:2222.
 * Approximate token count: bytes / 4 (rough average for English text).
 */

const SSH =
  "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 docs@docs.erfi.io";

function ssh(cmd: string): { bytes: number; lines: number; output: string } {
  try {
    const output = execSync(`${SSH} "${cmd}"`, {
      encoding: "utf-8",
      timeout: 30_000,
    });
    return {
      bytes: Buffer.byteLength(output),
      lines: output.split("\n").length,
      output,
    };
  } catch (e: any) {
    return { bytes: 0, lines: 0, output: e.stderr || "" };
  }
}

interface BenchmarkResult {
  question: string;
  search: { bytes: number; lines: number };
  skim: { bytes: number; lines: number };
  context: { bytes: number; lines: number };
  full: { bytes: number; lines: number };
}

const questions: {
  question: string;
  searchCmd: string;
  targetFile: string;
  grepPattern: string;
}[] = [
  {
    question: "How does Supabase RLS work?",
    searchCmd: "grep -rl 'Row Level Security' /docs/supabase/ | head -5",
    targetFile: "/docs/supabase/guides/database/postgres/row-level-security.md",
    grepPattern: "Row Level Security",
  },
  {
    question: "How to deploy a Cloudflare Worker?",
    searchCmd: "grep -rl 'wrangler deploy' /docs/cloudflare/ | head -5",
    targetFile: "/docs/cloudflare/get-started.md",
    grepPattern: "wrangler deploy",
  },
  {
    question: "What is a Postgres partial index?",
    searchCmd: "grep -rl 'partial index' /docs/postgres/ | head -5",
    targetFile: "/docs/postgres/indexes-partial.md",
    grepPattern: "partial index",
  },
  {
    question: "How does Vercel Fluid Compute work?",
    searchCmd: "grep -rl 'fluid compute' /docs/vercel/ | head -5",
    targetFile: "/docs/vercel/fluid-compute.md",
    grepPattern: "fluid compute",
  },
  {
    question: "How to set up AWS Lambda with S3?",
    searchCmd: "grep -rl 'S3' /docs/aws/lambda/ | head -5",
    targetFile: "/docs/aws/lambda/latest/dg/with-s3.md",
    grepPattern: "S3",
  },
  {
    question: "How does Supabase Auth handle JWTs?",
    searchCmd: "grep -rl 'JWT' /docs/supabase/guides/auth/ | head -5",
    targetFile: "/docs/supabase/guides/auth/jwts.md",
    grepPattern: "JWT",
  },
  {
    question: "What is Cloudflare KV?",
    searchCmd: "find /docs/cloudflare -path '*kv*' -name '*.md' | head -5",
    targetFile: "/docs/cloudflare/kv.md",
    grepPattern: "KV",
  },
  {
    question: "How to configure Postgres connection pooling?",
    searchCmd: "grep -rl 'connection pool' /docs/supabase/ | head -5",
    targetFile: "/docs/supabase/guides/database/connecting-to-postgres.md",
    grepPattern: "connection pool",
  },
];

describe("Token efficiency benchmark", () => {
  const results: BenchmarkResult[] = [];

  for (const q of questions) {
    it(`measures: ${q.question}`, () => {
      const search = ssh(q.searchCmd);
      const skim = ssh(`head -20 '${q.targetFile}'`);
      const context = ssh(
        `grep -A5 '${q.grepPattern}' '${q.targetFile}' | head -50`,
      );
      const full = ssh(`cat '${q.targetFile}'`);

      results.push({
        question: q.question,
        search: { bytes: search.bytes, lines: search.lines },
        skim: { bytes: skim.bytes, lines: skim.lines },
        context: { bytes: context.bytes, lines: context.lines },
        full: { bytes: full.bytes, lines: full.lines },
      });

      // Search should always be smaller than full (if both found results)
      if (full.bytes > 0 && search.bytes > 0) {
        expect(search.bytes).toBeLessThan(full.bytes);
      }
      // Skim should be smaller than full
      if (full.bytes > 0 && skim.bytes > 0) {
        expect(skim.bytes).toBeLessThanOrEqual(full.bytes);
      }
    });
  }

  it("prints summary table", () => {
    console.log("\n=== TOKEN EFFICIENCY BENCHMARK ===\n");
    console.log(
      "| Question | search (bytes) | skim 20L (bytes) | grep+ctx (bytes) | full (bytes) | savings vs full |",
    );
    console.log(
      "|----------|---------------|-----------------|-----------------|-------------|----------------|",
    );

    let totalSearch = 0;
    let totalSkim = 0;
    let totalContext = 0;
    let totalFull = 0;

    for (const r of results) {
      const savings =
        r.full.bytes > 0
          ? `${((1 - r.context.bytes / r.full.bytes) * 100).toFixed(0)}%`
          : "n/a";
      console.log(
        `| ${r.question.slice(0, 40).padEnd(40)} | ${String(r.search.bytes).padStart(13)} | ${String(r.skim.bytes).padStart(15)} | ${String(r.context.bytes).padStart(15)} | ${String(r.full.bytes).padStart(11)} | ${savings.padStart(14)} |`,
      );
      totalSearch += r.search.bytes;
      totalSkim += r.skim.bytes;
      totalContext += r.context.bytes;
      totalFull += r.full.bytes;
    }

    console.log(
      `| ${"TOTAL".padEnd(40)} | ${String(totalSearch).padStart(13)} | ${String(totalSkim).padStart(15)} | ${String(totalContext).padStart(15)} | ${String(totalFull).padStart(11)} | ${((1 - totalContext / totalFull) * 100).toFixed(0)}%`.padStart(15) + " |",
    );
    console.log(
      `\nApprox tokens: search=${Math.round(totalSearch / 4)}, skim=${Math.round(totalSkim / 4)}, grep=${Math.round(totalContext / 4)}, full=${Math.round(totalFull / 4)}`,
    );
  });
});
