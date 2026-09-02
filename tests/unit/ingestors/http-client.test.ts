import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchBufferWithRetry, NonRetryableHttpError } from "../../../src/ingestors/http-client.js";

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
