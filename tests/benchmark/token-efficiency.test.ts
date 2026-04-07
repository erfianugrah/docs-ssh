import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Token efficiency benchmark: SSH docs vs MCP tools.
 *
 * Compares two SSH workflows against MCP baselines:
 *   2-step: docs_search + docs_grep
 *   3-step: docs_search + docs_summary + targeted docs_read (section only)
 *
 * MCP baselines captured from actual tool calls on 2026-04-07.
 * Token estimate: bytes / 4.
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
  // 2-step workflow
  sshSearch: string;
  sshGrep: string;
  // 3-step workflow (search + summary + targeted read)
  sshSummary: string;
  sshTargeted: string;
  // MCP baseline
  mcpProvider: string;
  mcpBytes: number;
}

const questions: Question[] = [
  {
    question: "How does Supabase RLS work?",
    sshSearch: "grep -rl 'Row Level Security' /docs/supabase/ | head -5",
    sshGrep: "grep -A5 'Row Level Security' /docs/supabase/guides/database/postgres/row-level-security.md | head -40",
    sshSummary: "grep '^#' /docs/supabase/guides/database/postgres/row-level-security.md",
    sshTargeted: "sed -n '1,/^## Policies/p' /docs/supabase/guides/database/postgres/row-level-security.md",
    mcpProvider: "supabase MCP",
    mcpBytes: 45000,
  },
  {
    question: "How to deploy a Cloudflare Worker?",
    sshSearch: "grep -rl 'wrangler deploy' /docs/cloudflare/ | head -5",
    sshGrep: "grep -A5 'wrangler deploy' /docs/cloudflare/1-migrate-webpack-projects.md | head -30",
    sshSummary: "grep '^#' /docs/cloudflare/1-migrate-webpack-projects.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/cloudflare/1-migrate-webpack-projects.md",
    mcpProvider: "cloudflare MCP",
    mcpBytes: 6800,
  },
  {
    question: "What is a Postgres partial index?",
    sshSearch: "grep -rl 'partial index' /docs/postgres/ | head -5",
    sshGrep: "grep -A5 'partial index' /docs/postgres/indexes-partial.md | head -50",
    sshSummary: "grep '^#' /docs/postgres/indexes-partial.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/postgres/indexes-partial.md | head -30",
    mcpProvider: "context7",
    mcpBytes: 5000,
  },
  {
    question: "How does Vercel Fluid Compute work?",
    sshSearch: "grep -rl 'fluid compute' /docs/vercel/ | head -5",
    sshGrep: "grep -A5 'fluid compute' /docs/vercel/fluid-compute.md | head -40",
    sshSummary: "grep '^#' /docs/vercel/fluid-compute.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/vercel/fluid-compute.md | head -30",
    mcpProvider: "vercel MCP",
    mcpBytes: 2500,
  },
  {
    question: "How does Supabase Auth handle JWTs?",
    sshSearch: "grep -rl 'JWT' /docs/supabase/guides/auth/ | head -5",
    sshGrep: "grep -A5 'JWT' /docs/supabase/guides/auth/jwts.md | head -50",
    sshSummary: "grep '^#' /docs/supabase/guides/auth/jwts.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/supabase/guides/auth/jwts.md | head -30",
    mcpProvider: "supabase MCP",
    mcpBytes: 30000,
  },
  {
    question: "What is Cloudflare KV?",
    sshSearch: "find /docs/cloudflare -path '*kv*' -name '*.md' | head -5",
    sshGrep: "grep -A5 'KV' /docs/cloudflare/kv.md | head -40",
    sshSummary: "grep '^#' /docs/cloudflare/kv.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/cloudflare/kv.md | head -30",
    mcpProvider: "cloudflare MCP",
    mcpBytes: 6500,
  },
  {
    question: "How to set up AWS Lambda with S3?",
    sshSearch: "grep -rl 'S3' /docs/aws/lambda/ | head -5",
    sshGrep: "grep -A5 'S3' /docs/aws/lambda/latest/dg/with-s3.md | head -50",
    sshSummary: "grep '^#' /docs/aws/lambda/latest/dg/with-s3.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/aws/lambda/latest/dg/with-s3.md | head -30",
    mcpProvider: "n/a",
    mcpBytes: 0,
  },
  {
    question: "How to configure connection pooling?",
    sshSearch: "grep -rl 'connection pool' /docs/supabase/ | head -5",
    sshGrep: "grep -A5 'connection pool' /docs/supabase/guides/database/connecting-to-postgres.md | head -50",
    sshSummary: "grep '^#' /docs/supabase/guides/database/connecting-to-postgres.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/supabase/guides/database/connecting-to-postgres.md | head -30",
    mcpProvider: "supabase MCP",
    mcpBytes: 25000,
  },
];

describe("Token efficiency: SSH docs vs MCP", () => {
  interface Result {
    question: string;
    twoStep: number;
    threeStep: number;
    mcp: number;
    best: string;
  }

  const results: Result[] = [];

  for (const q of questions) {
    it(`${q.question}`, () => {
      const searchBytes = ssh(q.sshSearch);

      // 2-step: search + grep
      const grepBytes = ssh(q.sshGrep);
      const twoStep = searchBytes + grepBytes;

      // 3-step: search + summary + targeted read
      const summaryBytes = ssh(q.sshSummary);
      const targetedBytes = ssh(q.sshTargeted);
      const threeStep = searchBytes + summaryBytes + targetedBytes;

      const best =
        q.mcpBytes === 0
          ? "n/a"
          : Math.min(twoStep, threeStep) < q.mcpBytes
            ? "SSH"
            : "MCP";

      results.push({
        question: q.question,
        twoStep,
        threeStep,
        mcp: q.mcpBytes,
        best,
      });

      expect(searchBytes).toBeGreaterThan(0);
    });
  }

  it("prints comparison table", () => {
    console.log("\n=== TOKEN EFFICIENCY: SSH DOCS vs MCP ===\n");
    console.log(
      "| Question                           | 2-step | 3-step | MCP    | Winner | Savings    |",
    );
    console.log(
      "|------------------------------------|--------|--------|--------|--------|------------|",
    );

    let total2 = 0;
    let total3 = 0;
    let totalMcp = 0;
    let sshWins = 0;
    let mcpWins = 0;

    for (const r of results) {
      const bestSsh = Math.min(r.twoStep, r.threeStep);
      const savings =
        r.mcp > 0
          ? `${((1 - bestSsh / r.mcp) * 100).toFixed(0)}%`
          : "n/a";
      const winner = r.best;
      if (winner === "SSH") sshWins++;
      if (winner === "MCP") mcpWins++;

      console.log(
        `| ${r.question.slice(0, 34).padEnd(34)} | ${String(r.twoStep).padStart(6)} | ${String(r.threeStep).padStart(6)} | ${String(r.mcp).padStart(6)} | ${winner.padStart(6)} | ${savings.padStart(10)} |`,
      );
      total2 += r.twoStep;
      total3 += r.threeStep;
      if (r.mcp > 0) totalMcp += r.mcp;
    }

    const best3Total = Math.min(total2, total3);
    const totalSavings = ((1 - best3Total / totalMcp) * 100).toFixed(0);

    console.log(
      `| ${"TOTAL (excl n/a)".padEnd(34)} | ${String(total2).padStart(6)} | ${String(total3).padStart(6)} | ${String(totalMcp).padStart(6)} |        | ${(totalSavings + "%").padStart(10)} |`,
    );

    console.log(`\nSSH wins: ${sshWins}/${sshWins + mcpWins} queries`);
    console.log(
      `Best SSH: ~${Math.round(best3Total / 4)} tokens | MCP: ~${Math.round(totalMcp / 4)} tokens`,
    );
    console.log(
      `\n3-step (search→summary→targeted read) beats 2-step (search→grep) when files are large.`,
    );
    console.log(`MCP baselines captured 2026-04-07.`);
  });
});
