/**
 * commands/lib/cache.sh, sourced in a real POSIX sh. The cache lives on a
 * 16M tmpfs in prod; on 2026-11-05 it filled up (no eviction), every new
 * capture wrote 0 bytes, and the empty result was cached as the answer, so
 * all docs searches returned nothing until the cache was wiped by hand.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LIB = resolve("commands/lib/cache.sh");
let dir: string;
let cacheDir: string;

function sh(script: string, env: Record<string, string> = {}) {
  const r = spawnSync("sh", ["-c", `. '${LIB}'; ${script}`], {
    env: { PATH: process.env.PATH ?? "", CACHE_DIR: cacheDir, ...env },
    encoding: "utf8",
  });
  return { out: r.stdout, err: r.stderr, code: r.status };
}

const cached = () => readdirSync(cacheDir).filter((f) => f.endsWith(".out"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "docs-cache-"));
  cacheDir = join(dir, "cache");
  mkdirSync(cacheDir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("exec_and_cache", () => {
  it("caches a normal result and serves it on the next call", () => {
    expect(sh(`exec_and_cache "echo hello"`).out).toBe("hello\n");
    expect(cached()).toHaveLength(1);
    expect(sh(`try_cache "echo hello"`).out).toBe("hello\n");
  });

  it("evicts the cache once it is over its size budget", () => {
    for (let i = 0; i < 5; i++) writeFileSync(join(cacheDir, `old${i}.out`), "x".repeat(4096));
    const r = sh(`exec_and_cache "echo fresh"`, { CACHE_MAX_KB: "8" });
    expect(r.out).toBe("fresh\n");
    expect(readdirSync(cacheDir).some((f) => f.startsWith("old"))).toBe(false);
    expect(cached()).toHaveLength(1);
  });

  it("still returns the real output when the capture files cannot be written", () => {
    // Under a regular file, so creation fails with ENOTDIR even as root
    // (CI runs as root; a 0555 dir would not stop it).
    writeFileSync(join(dir, "afile"), "");
    const r = sh(`exec_and_cache "echo hello"`, { CACHE_DIR: join(dir, "afile", "cache") });
    expect(r.out).toBe("hello\n");
    expect(r.code).toBe(0);
    expect(cached()).toHaveLength(0);
  });

  it("discards a capture made on a full filesystem and re-runs uncached", () => {
    // _cache_free_kb is the df probe; 0 KB free after the run means the
    // capture may be truncated, so it must neither be served nor stored.
    const r = sh(`_cache_free_kb() { echo 0; }; exec_and_cache "echo hello"`);
    expect(r.out).toBe("hello\n");
    expect(cached()).toHaveLength(0);
  });
});
