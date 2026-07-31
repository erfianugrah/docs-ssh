import { describe, it, expect, vi } from "vitest";
import { backoffDelay, retryWithBackoff } from "../../../src/shared/retry.js";

describe("backoffDelay", () => {
  it("doubles the base delay per attempt (no jitter)", () => {
    expect(backoffDelay(0, { base: 1000, jitter: 0 })).toBe(1000);
    expect(backoffDelay(1, { base: 1000, jitter: 0 })).toBe(2000);
    expect(backoffDelay(2, { base: 1000, jitter: 0 })).toBe(4000);
    expect(backoffDelay(3, { base: 1000, jitter: 0 })).toBe(8000);
  });

  it("caps at max delay", () => {
    expect(backoffDelay(10, { base: 1000, max: 5_000, jitter: 0 })).toBe(5_000);
  });

  it("adds jitter in [0, jitter) fraction of the base delay", () => {
    // With jitter=0.25 and base delay 1000, result is in [1000, 1250)
    const samples = Array.from({ length: 200 }, () =>
      backoffDelay(0, { base: 1000, jitter: 0.25 }),
    );
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(1000);
      expect(s).toBeLessThan(1250);
    }
    // At least some variance — not all samples are the same
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(50);
  });
});

describe("retryWithBackoff", () => {
  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { retries: 2, base: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on throw and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("boom");
      return "ok";
    });
    const result = await retryWithBackoff(fn, { retries: 3, base: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("rethrows last error after exhausting retries", async () => {
    const err = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryWithBackoff(fn, { retries: 2, base: 1 })).rejects.toThrow(
      "permanent",
    );
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects shouldRetry predicate — stops early on non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      retryWithBackoff(fn, {
        retries: 3,
        base: 1,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses delayFromError when the thrown error carries a hint", async () => {
    // 429/503 responses include a Retry-After header. Callers can
    // surface that as a delay hint via delayFromError so the retry
    // honours the upstream's wishes instead of guessing exponentially.
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fn = async () => {
        calls++;
        if (calls < 2) {
          const err: Error & { retryAfterMs?: number } = new Error("rate limited");
          err.retryAfterMs = 75;
          throw err;
        }
        return "ok";
      };
      const start = Date.now();
      // Start without awaiting - the retry sleeps on a faked setTimeout.
      const p = retryWithBackoff(fn, {
        retries: 2,
        base: 100_000, // huge base - should be IGNORED in favour of the hint
        jitter: 0,
        delayFromError: (err) => (err as { retryAfterMs?: number }).retryAfterMs,
      });
      // Fire the 75ms hint sleep and flush the second attempt's microtasks.
      await vi.advanceTimersByTimeAsync(75);
      const result = await p;
      const elapsed = Date.now() - start;
      expect(result).toBe("ok");
      // Fake Date only advances when timers advance - the 75ms hint is exact.
      expect(elapsed).toBe(75);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to backoff when delayFromError returns undefined", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw new Error("boom");
      return "ok";
    };
    vi.useFakeTimers();
    try {
      const start = Date.now();
      // hint absent -> backoffDelay(0, {base:50, jitter:0}) === 50
      const p = retryWithBackoff(fn, {
        retries: 1,
        base: 50,
        jitter: 0,
        delayFromError: () => undefined,
      });
      await vi.advanceTimersByTimeAsync(50);
      const result = await p;
      expect(result).toBe("ok");
      expect(Date.now() - start).toBe(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes onRetry callback with attempt number and error", async () => {
    const onRetry = vi.fn();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return 42;
    };
    await retryWithBackoff(fn, { retries: 2, base: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(0, expect.any(Error), expect.any(Number));
  });
});
