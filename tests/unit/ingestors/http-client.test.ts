import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBufferWithRetry, NonRetryableHttpError, parseRetryAfter } from "../../../src/ingestors/http-client.js";

describe("fetchBufferWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries when the body read rejects mid-download, then succeeds", async () => {
    // Regression: gitea-api's swagger download stalled on a CI runner and
    // died as undici's "terminated" with no retry, because the body read
    // happened outside fetchWithRetry's retry loop.
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          throw new TypeError("terminated");
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('{"ok":true}').buffer,
      });
    vi.stubGlobal("fetch", mockFetch);

    const buf = await fetchBufferWithRetry("https://example.com/spec.json");
    expect(buf.toString("utf-8")).toBe('{"ok":true}');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchBufferWithRetry("https://example.com/missing")).rejects.toThrow(
      NonRetryableHttpError,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 and throws after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchBufferWithRetry("https://example.com/flaky", 1),
    ).rejects.toThrow("HTTP 500");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("default is 5 retries for bulk/gating fetches", async () => {
    // A 500 on a bulk download (sitemap, tarball, spec) drops the
    // entire source. Default must be high enough to ride out a
    // multi-second network blip on CI runners.
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", mockFetch);

    // Don't await - runTimersToCompletion would hang forever.
    const assertion = expect(
      fetchBufferWithRetry("https://example.com/bulk"),
    ).rejects.toThrow("HTTP 500");
    await vi.runAllTimersAsync();
    await assertion;
    // default BULK_RETRIES = 5: initial + 5 retries = 6 total
    expect(mockFetch).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });
});

describe("parseRetryAfter", () => {
  it("parses delay-seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("caps long delays at 5 minutes", () => {
    expect(parseRetryAfter("86400")).toBe(5 * 60_000);
  });

  it("parses a future HTTP-date", () => {
    const at = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(at)!;
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  // A zero or past hint carries no wait information. Returning 0 used to
  // override the exponential backoff, so a 429 storm retried instantly
  // (cloudflare-blog, 2026-10-05: 15k zero-delay retries, 7537/7934 pages
  // failed). Treat it as "no hint" so the caller backs off normally.
  it("treats Retry-After: 0 as no hint", () => {
    expect(parseRetryAfter("0")).toBeUndefined();
  });

  it("treats a past HTTP-date as no hint", () => {
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBeUndefined();
  });

  it("ignores absent and malformed headers", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
