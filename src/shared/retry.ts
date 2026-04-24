/**
 * Generic retry-with-backoff for transient failures.
 *
 * Adds jitter to the exponential delay so concurrent failures don't
 * retry on the same tick (thundering herd). The randomness is always
 * additive — the minimum wait is still the unjittered exponential
 * delay so retry latency has a predictable floor.
 */

export interface BackoffOptions {
  /** Base delay in ms (attempt 0). Default: 1000. */
  readonly base?: number;
  /** Upper cap on the exponential (pre-jitter) delay. Default: 30_000. */
  readonly max?: number;
  /** Jitter fraction in [0, 1). 0.25 means "add up to 25% of base delay". */
  readonly jitter?: number;
}

/**
 * Returns the delay in ms for a given retry attempt.
 * Formula: min(base * 2^attempt, max) + random(0, base * 2^attempt * jitter)
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.base ?? 1000;
  const max = opts.max ?? 30_000;
  const jitter = opts.jitter ?? 0.25;
  const raw = Math.min(base * 2 ** attempt, max);
  return raw + Math.random() * raw * jitter;
}

export interface RetryOptions extends BackoffOptions {
  /** Number of retries after the first attempt. Default: 2 (3 total attempts). */
  readonly retries?: number;
  /** Called before each retry with (attempt, error, delayMs). */
  readonly onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Return false to stop retrying on this error. Default: always retry. */
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
}

/**
 * Run `fn` up to `retries + 1` times, waiting with exponential backoff
 * + jitter between attempts. Throws the last error if all attempts fail.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      if (!shouldRetry(err, attempt)) break;
      const delay = backoffDelay(attempt, opts);
      opts.onRetry?.(attempt, err, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
