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
});
