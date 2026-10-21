/**
 * commands/lib/log.sh, sourced in a real POSIX sh: the docsop marker split
 * (clients prefix `: docsop <base64 json>; ` so the server logs the
 * operation, not the shell command), the structured JSONL line, the
 * healthcheck skip and the per-file size cap. Needs sh + jq + base64.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LIB = resolve("commands/lib/log.sh");
let dir: string;
let logFile: string;

function sh(script: string, env: Record<string, string> = {}): string {
  return execFileSync("sh", ["-c", `. '${LIB}'; ${script}`], {
    env: { PATH: process.env.PATH ?? "", LOG_FILE: logFile, CLIENT: "10.0.71.1", ...env },
    encoding: "utf8",
  });
}

function lines(): Array<Record<string, unknown>> {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "docs-log-"));
  logFile = join(dir, "docs-ssh.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("docsop_split", () => {
  it("strips the marker and keeps the meta", () => {
    const meta = b64({ op: "read", path: "/docs/pg/a.md", sid: "abc123" });
    const out = sh(`docsop_split ": docsop ${meta}; bat --plain '/docs/pg/a.md'"; printf '%s|%s' "$DOCS_CMD" "$DOCS_META"`);
    expect(out).toBe(`bat --plain '/docs/pg/a.md'|${meta}`);
  });

  it("passes a command without a marker through unchanged", () => {
    const out = sh(`docsop_split "rg -i 'x;y' /docs/_index.tsv"; printf '%s|%s' "$DOCS_CMD" "$DOCS_META"`);
    expect(out).toBe("rg -i 'x;y' /docs/_index.tsv|");
  });

  it("drops a meta that is not base64 (no shell metacharacters reach the log path)", () => {
    const out = sh(`docsop_split ': docsop $(id); head /docs/x.md'; printf '%s|%s' "$DOCS_CMD" "$DOCS_META"`);
    expect(out).toBe("head /docs/x.md|");
  });
});

describe("log_json", () => {
  it("merges whitelisted meta fields into the line", () => {
    const meta = b64({ op: "search", q: "row level security", source: "postgres", sid: "s1", junk: "x" });
    sh(`DOCS_META='${meta}'; log_json exec "rg ..." 0 1 false`);
    const [l] = lines();
    expect(l).toMatchObject({ type: "exec", client: "10.0.71.1", cmd: "rg ...", op: "search", q: "row level security", source: "postgres", sid: "s1" });
    expect(l).not.toHaveProperty("junk");
  });

  it("logs a plain line when meta is absent or undecodable", () => {
    sh(`DOCS_META='bm90IGpzb24='; log_json exec "head x"`);
    sh(`log_json exec "head y"`);
    const ls = lines();
    expect(ls).toHaveLength(2);
    expect(ls[0]).not.toHaveProperty("op");
    expect(ls[1].cmd).toBe("head y");
  });

  it("skips the container healthcheck (echo ok from localhost)", () => {
    sh(`log_json exec "echo ok"`, { CLIENT: "127.0.0.1" });
    sh(`log_json exec.done "echo ok" 0 0 false`, { CLIENT: "::1" });
    sh(`log_json exec "echo ok"`, { CLIENT: "10.0.71.1" });
    expect(lines()).toHaveLength(1);
  });

  it("stops appending once the file reaches LOG_MAX_BYTES", () => {
    writeFileSync(logFile, "x".repeat(2000) + "\n");
    sh(`log_json exec "head z"`, { LOG_MAX_BYTES: "1000" });
    expect(readFileSync(logFile, "utf8")).not.toContain("head z");
  });
});
