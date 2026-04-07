import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Token efficiency benchmark.
 *
 * Measures TOTAL bytes entering the LLM context for a complete retrieval
 * workflow, comparing SSH docs tools vs MCP tools.
 *
 * Methodology:
 * - SSH (2-step): docs_search response + docs_grep/docs_read response
 * - MCP (1-step): single tool response (search_docs, search_cloudflare_documentation, etc.)
 *
 * MCP baselines are captured from actual tool calls and hardcoded here because
 * MCP tools can only be called by the LLM, not from test code. The baselines
 * should be re-captured periodically as MCP providers update their responses.
 *
 * Token estimate: bytes / 4 (rough average for English text + markdown)
 *
 * Last MCP baseline capture: 2026-04-07
 */

const SSH =
  "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 docs@docs.erfi.io";

function ssh(cmd: string): number {
  try {
    const output = execSync(`${SSH} "${cmd}"`, {
      encoding: "utf-8",
      timeout: 30_000,
    });
    return Buffer.byteLength(output);
  } catch {
    return 0;
  }
}

interface Question {
  question: string;
  /** SSH step 1: search for relevant files */
  sshSearch: string;
  /** SSH step 2: read the answer (grep with context or head) */
  sshRead: string;
  /** MCP provider name */
  mcpProvider: string;
  /** Bytes returned by the MCP tool for the same question (captured baseline) */
  mcpBytes: number;
  /** What the MCP returned */
  mcpNote: string;
}

const questions: Question[] = [
  {
    question: "How does Supabase RLS work?",
    sshSearch: "grep -rl 'Row Level Security' /docs/supabase/ | head -5",
    sshRead:
      "grep -A5 'Row Level Security' /docs/supabase/guides/database/postgres/row-level-security.md | head -40",
    mcpProvider: "supabase MCP (search_docs)",
    mcpBytes: 45000,
    mcpNote: "3 full pages: RLS, Column Level Security, Securing Your API",
  },
  {
    question: "How to deploy a Cloudflare Worker?",
    sshSearch: "grep -rl 'wrangler deploy' /docs/cloudflare/ | head -5",
    sshRead:
      "grep -A5 'wrangler deploy' /docs/cloudflare/1-migrate-webpack-projects.md | head -30",
    mcpProvider: "cloudflare MCP (search_cloudflare_documentation)",
    mcpBytes: 6800,
    mcpNote: "10 semantic chunks from various pages",
  },
  {
    question: "What is a Postgres partial index?",
    sshSearch: "grep -rl 'partial index' /docs/postgres/ | head -5",
    sshRead:
      "grep -A5 'partial index' /docs/postgres/indexes-partial.md | head -50",
    mcpProvider: "context7 (query-docs)",
    mcpBytes: 5000,
    mcpNote: "estimated ~5KB chunk (context7 was unavailable for exact capture)",
  },
  {
    question: "How does Vercel Fluid Compute work?",
    sshSearch: "grep -rl 'fluid compute' /docs/vercel/ | head -5",
    sshRead:
      "grep -A5 'fluid compute' /docs/vercel/fluid-compute.md | head -40",
    mcpProvider: "vercel MCP (search_vercel_documentation)",
    mcpBytes: 2500,
    mcpNote: "default 2500 token response",
  },
  {
    question: "How does Supabase Auth handle JWTs?",
    sshSearch: "grep -rl 'JWT' /docs/supabase/guides/auth/ | head -5",
    sshRead:
      "grep -A5 'JWT' /docs/supabase/guides/auth/jwts.md | head -50",
    mcpProvider: "supabase MCP (search_docs)",
    mcpBytes: 30000,
    mcpNote: "2-3 full auth pages",
  },
  {
    question: "What is Cloudflare KV?",
    sshSearch: "find /docs/cloudflare -path '*kv*' -name '*.md' | head -5",
    sshRead:
      "grep -A5 'KV' /docs/cloudflare/kv.md | head -40",
    mcpProvider: "cloudflare MCP (search_cloudflare_documentation)",
    mcpBytes: 6500,
    mcpNote: "10 semantic chunks about KV",
  },
  {
    question: "How to set up AWS Lambda with S3?",
    sshSearch: "grep -rl 'S3' /docs/aws/lambda/ | head -5",
    sshRead:
      "grep -A5 'S3' /docs/aws/lambda/latest/dg/with-s3.md | head -50",
    mcpProvider: "no MCP available for AWS docs",
    mcpBytes: 0,
    mcpNote: "n/a",
  },
  {
    question: "How to configure connection pooling?",
    sshSearch: "grep -rl 'connection pool' /docs/supabase/ | head -5",
    sshRead:
      "grep -A5 'connection pool' /docs/supabase/guides/database/connecting-to-postgres.md | head -50",
    mcpProvider: "supabase MCP (search_docs)",
    mcpBytes: 25000,
    mcpNote: "2 full pages about connecting to postgres",
  },
];

describe("Token efficiency: SSH docs vs MCP", () => {
  const results: {
    question: string;
    sshSearchBytes: number;
    sshReadBytes: number;
    sshTotal: number;
    mcpProvider: string;
    mcpBytes: number;
    mcpNote: string;
    ratio: string;
  }[] = [];

  for (const q of questions) {
    it(`${q.question}`, () => {
      const sshSearchBytes = ssh(q.sshSearch);
      const sshReadBytes = ssh(q.sshRead);
      const sshTotal = sshSearchBytes + sshReadBytes;

      results.push({
        question: q.question,
        sshSearchBytes,
        sshReadBytes,
        sshTotal,
        mcpProvider: q.mcpProvider,
        mcpBytes: q.mcpBytes,
        mcpNote: q.mcpNote,
        ratio:
          q.mcpBytes > 0
            ? `${(q.mcpBytes / Math.max(sshTotal, 1)).toFixed(0)}x`
            : "n/a",
      });

      // Record the comparison — not asserting SSH always wins,
      // since grep granularity depends on the query and file size.
      // The benchmark reports results; the overall trend matters.
      expect(sshTotal).toBeGreaterThan(0);
    });
  }

  it("prints comparison table", () => {
    console.log("\n=== TOKEN EFFICIENCY: SSH DOCS vs MCP ===\n");
    console.log(
      "Methodology: total bytes entering LLM context for a complete retrieval workflow.",
    );
    console.log(
      "SSH = docs_search + docs_grep (2 calls). MCP = single search tool call.\n",
    );
    console.log(
      "| Question                           | SSH total | MCP total | MCP provider                 | SSH savings |",
    );
    console.log(
      "|------------------------------------|-----------|-----------|------------------------------|-------------|",
    );

    let totalSsh = 0;
    let totalMcp = 0;

    for (const r of results) {
      const savings =
        r.mcpBytes > 0
          ? `${((1 - r.sshTotal / r.mcpBytes) * 100).toFixed(0)}% (${r.ratio})`
          : "n/a";
      console.log(
        `| ${r.question.slice(0, 34).padEnd(34)} | ${String(r.sshTotal).padStart(9)} | ${String(r.mcpBytes).padStart(9)} | ${r.mcpProvider.slice(0, 28).padEnd(28)} | ${savings.padStart(11)} |`,
      );
      totalSsh += r.sshTotal;
      if (r.mcpBytes > 0) totalMcp += r.mcpBytes;
    }

    const totalSavings = ((1 - totalSsh / totalMcp) * 100).toFixed(0);
    console.log(
      `| ${"TOTAL (excl n/a)".padEnd(34)} | ${String(totalSsh).padStart(9)} | ${String(totalMcp).padStart(9)} | ${"".padEnd(28)} | ${(totalSavings + "%").padStart(11)} |`,
    );

    console.log(
      `\nSSH: ~${Math.round(totalSsh / 4)} tokens | MCP: ~${Math.round(totalMcp / 4)} tokens`,
    );
    console.log(
      `\nNote: MCP baselines captured 2026-04-07. Re-run MCP calls periodically to update.`,
    );
    console.log(
      `MCP responses vary by query — these are representative, not exact.`,
    );
  });
});
