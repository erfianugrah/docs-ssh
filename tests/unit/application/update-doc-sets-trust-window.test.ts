import { describe, it, expect, vi, afterEach } from "vitest";
import { UpdateDocSets } from "../../../src/application/UpdateDocSets.js";
import { DocFile } from "../../../src/domain/DocFile.js";
import { DocSet } from "../../../src/domain/DocSet.js";
import { DocSource } from "../../../src/domain/DocSource.js";
import type { DocIngestor } from "../../../src/domain/DocIngestor.js";
import type { DocNormaliser } from "../../../src/domain/DocNormaliser.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Trust-window policy: when remote freshness CANNOT be determined
 * (no ETag/Last-Modified, HEAD errors, or a git stamp without gitSha)
 * and the stamp is still inside the maxAge window, the source is
 * skipped with a one-line trust log instead of being re-scraped.
 * Tests 1 and 5 are the sensor contract: they fail on the pre-change
 * code, where "cannot determine" collapsed to "assume stale".
 */

const HOUR_MS = 3_600_000;
const MAX_AGE_S = 86_400; // 24h

const makeHttpSource = (name: string) =>
  new DocSource({ name, type: "http", format: "markdown", url: "https://example.com/" });

const makeGitSource = (name: string) =>
  new DocSource({ name, type: "git", format: "markdown", url: "https://example.com/repo.git" });

/** A mock ingestor that counts invocations. */
function countingIngestor(docSet: DocSet): DocIngestor & { ingest: ReturnType<typeof vi.fn> } {
  const ingest = vi.fn(async () => docSet);
  return { name: "CountingIngestor", supports: () => true, ingest };
}

const noopNormaliser: DocNormaliser = {
  name: "NoopNormaliser",
  supports: () => false,
  supportsFormat: () => false,
  normalise: async (file) => file,
};

async function makeTmp(): Promise<{ tmpDir: string; outDir: string; workDir: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uds-trust-"));
  const outDir = path.join(tmpDir, "out");
  const workDir = path.join(tmpDir, "work");
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  return { tmpDir, outDir, workDir };
}

async function writeStamp(outDir: string, sourceName: string, stamp: Record<string, unknown>) {
  const dir = path.join(outDir, sourceName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ".stamp.json"), JSON.stringify(stamp));
}

function docSetFor(source: DocSource): DocSet {
  return new DocSet(source, new Map([["a.md", new DocFile("a.md", "# A")]]));
}

/** Run the updater while capturing console.log lines. */
async function runCapturingLogs(updater: UpdateDocSets) {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const results = await updater.run();
    return { results, logs };
  } finally {
    console.log = origLog;
  }
}

/** Stub global fetch to answer HEAD requests with the given headers. */
function stubHead(headers: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200, headers })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("freshness trust window", () => {
  it("skips a validator-less http source whose stamp is within maxAge, with a trust log", async () => {
    const { tmpDir, outDir, workDir } = await makeTmp();
    const source = makeHttpSource("vless-http");
    await writeStamp(outDir, source.name, {
      fetchedAt: new Date(Date.now() - HOUR_MS).toISOString(), // 1h ago, within 24h window
    });
    // Upstream answers HEAD but offers no ETag / Last-Modified.
    stubHead({});

    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: MAX_AGE_S,
    });

    // The private check itself must report "unknown", not "stale".
    const verdict = await (updater as any).checkRemoteFreshness(source, {
      fetchedAt: new Date().toISOString(),
    });
    expect(verdict).toBe("unknown");

    const { results, logs } = await runCapturingLogs(updater);

    expect(results[0].status).toBe("skipped");
    expect(ingestor.ingest).not.toHaveBeenCalled();
    expect(
      logs.some((l) =>
        /\[vless-http\] no remote validators; trusting cache \(age 1h of 24h window\)/.test(l),
      ),
    ).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("re-fetches a validator-less http source whose stamp is beyond maxAge", async () => {
    const { tmpDir, outDir, workDir } = await makeTmp();
    const source = makeHttpSource("vless-old");
    await writeStamp(outDir, source.name, {
      fetchedAt: new Date(Date.now() - 25 * HOUR_MS).toISOString(), // outside 24h window
    });
    stubHead({});

    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: MAX_AGE_S,
    });

    const { results, logs } = await runCapturingLogs(updater);

    expect(results[0].status).toBe("ok");
    expect(ingestor.ingest).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("trusting cache"))).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("re-fetches an http source whose ETag changed, even within the window", async () => {
    const { tmpDir, outDir, workDir } = await makeTmp();
    const source = makeHttpSource("etag-changed");
    await writeStamp(outDir, source.name, {
      fetchedAt: new Date(Date.now() - HOUR_MS).toISOString(),
      etag: '"old-etag"',
    });
    stubHead({ etag: '"new-etag"' });

    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: MAX_AGE_S,
    });

    // A differing validator is a real upstream change: "changed", never "unknown".
    const verdict = await (updater as any).checkRemoteFreshness(source, {
      fetchedAt: new Date().toISOString(),
      etag: '"old-etag"',
    });
    expect(verdict).toBe("changed");

    const { results, logs } = await runCapturingLogs(updater);

    expect(results[0].status).toBe("ok");
    expect(ingestor.ingest).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("trusting cache"))).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("skips an http source whose ETag is unchanged, within the window", async () => {
    const { tmpDir, outDir, workDir } = await makeTmp();
    const source = makeHttpSource("etag-same");
    await writeStamp(outDir, source.name, {
      fetchedAt: new Date(Date.now() - HOUR_MS).toISOString(),
      etag: '"same-etag"',
    });
    stubHead({ etag: '"same-etag"' });

    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: MAX_AGE_S,
    });

    const verdict = await (updater as any).checkRemoteFreshness(source, {
      fetchedAt: new Date().toISOString(),
      etag: '"same-etag"',
    });
    expect(verdict).toBe("fresh");

    const { results, logs } = await runCapturingLogs(updater);

    expect(results[0].status).toBe("skipped");
    expect(ingestor.ingest).not.toHaveBeenCalled();
    // Verified-fresh skip, not a trust-window skip.
    expect(logs.some((l) => l.includes("trusting cache"))).toBe(false);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("skips a git source whose stamp has no gitSha, within the window", async () => {
    const { tmpDir, outDir, workDir } = await makeTmp();
    const source = makeGitSource("vless-git");
    await writeStamp(outDir, source.name, {
      fetchedAt: new Date(Date.now() - HOUR_MS).toISOString(), // no gitSha
    });

    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: MAX_AGE_S,
    });

    // No gitSha -> nothing to compare against ls-remote: "unknown".
    const verdict = await (updater as any).checkRemoteFreshness(source, {
      fetchedAt: new Date().toISOString(),
    });
    expect(verdict).toBe("unknown");

    const { results, logs } = await runCapturingLogs(updater);

    expect(results[0].status).toBe("skipped");
    expect(ingestor.ingest).not.toHaveBeenCalled();
    expect(
      logs.some((l) =>
        /\[vless-git\] no remote validators; trusting cache \(age 1h of 24h window\)/.test(l),
      ),
    ).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });
});

/**
 * Refetch floor: a source with minRefetchSeconds is never re-scraped
 * more often than that, even on maxAge=0 builds (fetcher change, manual
 * refresh). archwiki blocked the runner IP at the TLS layer after two
 * full 2169-page scrapes ~26h apart (2026-11-03/04).
 */
describe("per-source refetch floor (minRefetchSeconds)", () => {
  const makeFloored = (name: string, floorH: number) =>
    new DocSource({
      name,
      type: "http",
      format: "markdown",
      url: "https://example.com/",
      minRefetchSeconds: floorH * 3600,
    });

  async function runFloored(source: DocSource, stampAgeH?: number) {
    const { tmpDir, outDir, workDir } = await makeTmp();
    if (stampAgeH !== undefined) {
      await writeStamp(outDir, source.name, {
        fetchedAt: new Date(Date.now() - stampAgeH * HOUR_MS).toISOString(),
      });
    }
    stubHead({ etag: '"changed"' });
    const ingestor = countingIngestor(docSetFor(source));
    const updater = new UpdateDocSets({
      sources: [source],
      ingestors: [ingestor],
      normalisers: [noopNormaliser],
      outDir,
      workDir,
      maxAge: 0, // fetcher-changed / manual-refresh build
    });
    const out = await runCapturingLogs(updater);
    await fs.rm(tmpDir, { recursive: true });
    return { ...out, ingestor };
  }

  it("skips a source refetched within its floor even when maxAge is 0", async () => {
    const { results, logs, ingestor } = await runFloored(makeFloored("floored-recent", 168), 26);
    expect(results[0].status).toBe("skipped");
    expect(ingestor.ingest).not.toHaveBeenCalled();
    expect(
      logs.some((l) => /\[floored-recent\] refetch floor: cached 26h ago \(floor 168h\)/.test(l)),
    ).toBe(true);
  });

  it("refetches a floored source once its stamp is older than the floor", async () => {
    const { results, ingestor } = await runFloored(makeFloored("floored-old", 168), 169);
    expect(results[0].status).toBe("ok");
    expect(ingestor.ingest).toHaveBeenCalledTimes(1);
  });

  it("fetches a floored source with no previous stamp", async () => {
    const { results, ingestor } = await runFloored(makeFloored("floored-new", 168));
    expect(results[0].status).toBe("ok");
    expect(ingestor.ingest).toHaveBeenCalledTimes(1);
  });
});
