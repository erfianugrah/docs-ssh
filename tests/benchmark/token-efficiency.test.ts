import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

/**
 * Token efficiency + accuracy benchmark: SSH docs vs MCP tools.
 *
 * For each question, measures:
 *   1. Token efficiency — bytes returned by 2-step and 3-step SSH vs MCP
 *   2. Accuracy — the response must contain key phrases that answer the question
 *
 * MCP baselines captured from actual tool calls on 2026-04-07.
 */

const SSH =
  "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -p 2222 docs@docs.erfi.io";

function sshText(cmd: string): string {
  try {
    return execSync(`${SSH} "${cmd}"`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
  } catch {
    return "";
  }
}

interface Question {
  question: string;
  sshSearch: string;
  sshGrep: string;
  sshSummary: string;
  sshTargeted: string;
  mcpProvider: string;
  mcpBytes: number;
  /** Key phrases the answer MUST contain to be considered accurate */
  requiredPhrases: string[];
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
    requiredPhrases: ["Row Level Security", "enable row level security", "policy"],
  },
  {
    question: "How to deploy a Cloudflare Worker?",
    sshSearch: "grep -rl 'wrangler deploy' /docs/cloudflare/ | head -5",
    sshGrep: "grep -A5 'wrangler deploy' /docs/cloudflare/1-migrate-webpack-projects.md | head -30",
    sshSummary: "grep '^#' /docs/cloudflare/1-migrate-webpack-projects.md",
    sshTargeted: "sed -n '1,/^## /p' /docs/cloudflare/1-migrate-webpack-projects.md",
    mcpProvider: "cloudflare MCP",
    mcpBytes: 6800,
    requiredPhrases: ["wrangler deploy"],
  },
  {
    question: "What is a Postgres partial index?",
    sshSearch: "grep -rl 'partial index' /docs/postgres/ | head -5",
    sshGrep: "grep -A5 'partial index' /docs/postgres/indexes-partial.md | head -20",
    sshSummary: "grep '^#' /docs/postgres/indexes-partial.md",
    sshTargeted: "sed -n '/^## 11.8/,/^## [^#]/p' /docs/postgres/indexes-partial.md | head -30",
    mcpProvider: "context7",
    mcpBytes: 5000,
    requiredPhrases: ["partial index", "subset", "predicate"],
  },
  {
    question: "How does Vercel Fluid Compute work?",
    sshSearch: "grep -rl 'fluid compute' /docs/vercel/ | head -5",
    sshGrep: "grep -A5 'Fluid compute' /docs/vercel/fluid-compute.md | head -20",
    sshSummary: "grep '^#' /docs/vercel/fluid-compute.md",
    sshTargeted: "head -30 /docs/vercel/fluid-compute.md",
    mcpProvider: "vercel MCP",
    mcpBytes: 2500,
    requiredPhrases: ["Fluid", "concurrency"],
  },
  {
    question: "How does Supabase Auth handle JWTs?",
    sshSearch: "grep -rl 'JWT' /docs/supabase/guides/auth/ | head -5",
    sshGrep: "grep -A5 'JWT' /docs/supabase/guides/auth/jwts.md | head -30",
    sshSummary: "grep '^#' /docs/supabase/guides/auth/jwts.md",
    sshTargeted: "head -40 /docs/supabase/guides/auth/jwts.md",
    mcpProvider: "supabase MCP",
    mcpBytes: 30000,
    requiredPhrases: ["JWT", "token"],
  },
  {
    question: "What is Cloudflare KV?",
    sshSearch: "find /docs/cloudflare -path '*kv*' -name '*.md' | head -5",
    sshGrep: "grep -A5 'KV' /docs/cloudflare/how-kv-works.md | head -20",
    sshSummary: "grep '^#' /docs/cloudflare/how-kv-works.md",
    sshTargeted: "head -20 /docs/cloudflare/how-kv-works.md",
    mcpProvider: "cloudflare MCP",
    mcpBytes: 6500,
    requiredPhrases: ["KV", "key-value"],
  },
  {
    question: "How to set up AWS Lambda with S3?",
    sshSearch: "grep -rl 'S3' /docs/aws/lambda/ | head -5",
    sshGrep: "grep -A5 'S3' /docs/aws/lambda/latest/dg/with-s3.md | head -30",
    sshSummary: "grep '^#' /docs/aws/lambda/latest/dg/with-s3.md",
    sshTargeted: "head -30 /docs/aws/lambda/latest/dg/with-s3.md",
    mcpProvider: "n/a",
    mcpBytes: 0,
    requiredPhrases: ["S3", "Lambda"],
  },
  {
    question: "How to configure connection pooling?",
    sshSearch: "grep -rl 'connection pool' /docs/supabase/ | head -5",
    sshGrep: "grep -A5 'connection pool' /docs/supabase/guides/database/connecting-to-postgres.md | head -30",
    sshSummary: "grep '^#' /docs/supabase/guides/database/connecting-to-postgres.md",
    sshTargeted: "head -40 /docs/supabase/guides/database/connecting-to-postgres.md",
    mcpProvider: "supabase MCP",
    mcpBytes: 25000,
    requiredPhrases: ["connection", "pool"],
  },
];

describe("Token efficiency: SSH docs vs MCP", () => {
  interface Result {
    question: string;
    twoStep: number;
    threeStep: number;
    bestSsh: number;
    mcp: number;
    winner: string;
    grepAccurate: boolean;
    targetedAccurate: boolean;
  }

  const results: Result[] = [];

  for (const q of questions) {
    it(`${q.question}`, () => {
      const searchText = sshText(q.sshSearch);
      const searchBytes = Buffer.byteLength(searchText);

      // 2-step
      const grepText = sshText(q.sshGrep);
      const grepBytes = Buffer.byteLength(grepText);
      const twoStep = searchBytes + grepBytes;

      // 3-step
      const summaryText = sshText(q.sshSummary);
      const summaryBytes = Buffer.byteLength(summaryText);
      const targetedText = sshText(q.sshTargeted);
      const targetedBytes = Buffer.byteLength(targetedText);
      const threeStep = searchBytes + summaryBytes + targetedBytes;

      // Accuracy: check both approaches contain required phrases
      const grepAccurate = q.requiredPhrases.every(
        (p) => grepText.toLowerCase().includes(p.toLowerCase()),
      );
      const targetedAccurate = q.requiredPhrases.every(
        (p) => targetedText.toLowerCase().includes(p.toLowerCase()),
      );

      const bestSsh = Math.min(twoStep, threeStep);
      const winner =
        q.mcpBytes === 0
          ? "n/a"
          : bestSsh < q.mcpBytes
            ? "SSH"
            : "MCP";

      results.push({
        question: q.question,
        twoStep,
        threeStep,
        bestSsh,
        mcp: q.mcpBytes,
        winner,
        grepAccurate,
        targetedAccurate,
      });

      // At least one approach must return content
      expect(searchBytes).toBeGreaterThan(0);
      // At least one approach must be accurate
      expect(grepAccurate || targetedAccurate).toBe(true);
    });
  }

  it("prints comparison table", () => {
    console.log("\n=== TOKEN EFFICIENCY + ACCURACY: SSH DOCS vs MCP ===\n");
    console.log(
      "| Question                           | 2-step | 3-step | Best   | MCP    | Saves  | 2s acc | 3s acc |",
    );
    console.log(
      "|------------------------------------|--------|--------|--------|--------|--------|--------|--------|",
    );

    let totalBest = 0;
    let totalMcp = 0;
    let sshWins = 0;
    let mcpWins = 0;
    let accurate2 = 0;
    let accurate3 = 0;

    for (const r of results) {
      const savings =
        r.mcp > 0
          ? `${((1 - r.bestSsh / r.mcp) * 100).toFixed(0)}%`
          : "n/a";
      if (r.winner === "SSH") sshWins++;
      if (r.winner === "MCP") mcpWins++;
      if (r.grepAccurate) accurate2++;
      if (r.targetedAccurate) accurate3++;

      console.log(
        `| ${r.question.slice(0, 34).padEnd(34)} | ${String(r.twoStep).padStart(6)} | ${String(r.threeStep).padStart(6)} | ${String(r.bestSsh).padStart(6)} | ${String(r.mcp).padStart(6)} | ${savings.padStart(6)} | ${(r.grepAccurate ? "  yes " : "  NO  ")} | ${(r.targetedAccurate ? "  yes " : "  NO  ")} |`,
      );
      totalBest += r.bestSsh;
      if (r.mcp > 0) totalMcp += r.mcp;
    }

    const totalSavings = ((1 - totalBest / totalMcp) * 100).toFixed(0);
    console.log(
      `| ${"TOTAL".padEnd(34)} | ${"".padStart(6)} | ${"".padStart(6)} | ${String(totalBest).padStart(6)} | ${String(totalMcp).padStart(6)} | ${(totalSavings + "%").padStart(6)} | ${String(accurate2) + "/8  "} | ${String(accurate3) + "/8  "} |`,
    );

    console.log(`\nSSH wins: ${sshWins}/${sshWins + mcpWins} queries`);
    console.log(
      `Best SSH: ~${Math.round(totalBest / 4)} tokens | MCP: ~${Math.round(totalMcp / 4)} tokens`,
    );
    console.log(`Accuracy: 2-step ${accurate2}/8 | 3-step ${accurate3}/8`);
    console.log(`\nMCP baselines captured 2026-04-07.`);
  });
});
