/**
 * Shared HTTP client for HttpIngestor and discovery sub-modules.
 *
 * Originally lived inside HttpIngestor.ts. Lifted to a separate module
 * so the per-discovery-method files (./discovery/*) can import it
 * without creating a circular reference back through HttpIngestor.
 *
 * Exports:
 *   - fetchWithRetry - retry-with-backoff fetch honouring Retry-After
 *   - fetchBufferWithRetry - same, but with the body read INSIDE the retry
 *     loop (for bulk downloads: tarballs, specs, llms-full, archives)
 *   - parseRetryAfter — RFC 7231 §7.1.3 parser (seconds or HTTP-date)
 *   - RetryableHttpError — thrown for retryable 5xx/413/429 statuses
 *   - UA — User-Agent string sent on every request
 *   - REQUEST_TIMEOUT / BULK_TIMEOUT / MAX_RETRIES / BULK_RETRIES - defaults
 *   - CONCURRENCY — page-fetch parallelism cap (shared by discovery)
 */
import { retryWithBackoff } from "../shared/retry.js";

export const UA = "docs-ssh/0.8 (doc-fetcher; +https://github.com/erfianugrah/docs-ssh)";
export const MAX_RETRIES = 2;
// Bulk downloads (tarball, llms-full, OpenAPI spec) and discovery fetches
// (sitemap, toc, llms.txt, rss) gate an ENTIRE source: one failed fetch
// drops the source to zero files, whereas a failed per-page fetch only
// loses one page. A multi-second network blip on a GH runner is common
// enough that 2 retries (~3s of backoff) isn't enough - bump these to 5
// (~30s of exponential backoff) so a transient blip doesn't silently
// drop a source (seen 2026-09: sops dropped from the v0.26.0 image when
// getsops.io/sitemap.xml failed all 3 attempts).
export const BULK_RETRIES = 5;
export const REQUEST_TIMEOUT = 30_000; // 30s per page fetch
export const BULK_TIMEOUT = 120_000;   // 120s for large single-file downloads (llms-full, tarball, specs)
export const CONCURRENCY = 15;

/**
 * Combine an external AbortSignal with a per-attempt timeout, so a
 * caller can cancel in-flight retries (e.g. UpdateDocSets.withDeadline)
 * without losing the per-fetch timeout safety net.
 */
export function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, external]);
  }
  // Pre-Node-20 fallback (not needed today, but cheap to keep).
  const ctrl = new AbortController();
  for (const s of [timeout, external]) {
    if (s.aborted) ctrl.abort(s.reason);
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Thrown for a non-retryable HTTP status (4xx other than 413/429). */
export class NonRetryableHttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "NonRetryableHttpError";
  }
}

/** Thrown to signal a retryable HTTP status; caller unwraps on final attempt. */
export class RetryableHttpError extends Error {
  /** Server-suggested delay (ms), parsed from Retry-After header if present. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    public readonly response: Response,
  ) {
    super(message);
    this.name = "RetryableHttpError";
    // Defensive: mocked Response objects in unit tests may lack a
    // `headers` property. Real `fetch` always provides Headers.
    const header = response.headers?.get?.("retry-after") ?? null;
    this.retryAfterMs = parseRetryAfter(header);
  }
}

/**
 * RFC 7231 §7.1.3 Retry-After is either a non-negative integer
 * (seconds) or an HTTP-date. Returns a delay in milliseconds, or
 * undefined when the header is absent / malformed / in the past.
 *
 * Capped at 5 minutes — any longer and the source-deadline is going
 * to fire anyway, so it's better to fail fast than block the whole
 * batch on a single rate-limited URL.
 */
const RETRY_AFTER_MAX_MS = 5 * 60_000;
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  // Numeric: seconds.
  if (/^\d+$/.test(trimmed)) {
    const ms = parseInt(trimmed, 10) * 1000;
    return Math.min(ms, RETRY_AFTER_MAX_MS);
  }
  // HTTP-date.
  const at = Date.parse(trimmed);
  if (!Number.isNaN(at)) {
    const delta = at - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

/**
 * Fetch with User-Agent header, per-attempt timeout, and retry on
 * transient failures (network errors, 5xx, 413, 429). Uses exponential
 * backoff with jitter so concurrent failures don't retry in lockstep.
 *
 * Non-retryable 4xx (404, 403, etc.) return the Response so the caller
 * can inspect status. Retryable statuses throw a RetryableHttpError
 * that retryWithBackoff handles internally; on final exhaustion the
 * Response is unwrapped and returned (consistent with the success
 * path) so the caller never has to catch RetryableHttpError.
 *
 * If `signal` is provided, abortion stops both the in-flight fetch
 * and the retry loop (via shouldRetry).
 */
export async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
  timeout = REQUEST_TIMEOUT,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return retryWithBackoff(
    async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, ...(extraHeaders ?? {}) },
        signal: combineSignals(timeout, signal),
      });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 413 && res.status !== 429) {
        return res;
      }
      throw new RetryableHttpError(`HTTP ${res.status} for ${url}`, res);
    },
    {
      retries,
      shouldRetry: () => !signal?.aborted,
      delayFromError: (err) =>
        err instanceof RetryableHttpError ? err.retryAfterMs : undefined,
      onRetry: (_attempt, err, delay) => {
        const msg = err instanceof Error ? err.message : String(err);
        const hinted =
          err instanceof RetryableHttpError && err.retryAfterMs !== undefined
            ? " (Retry-After honoured)"
            : "";
        console.warn(`  [retry] ${url} → ${msg}, waiting ${Math.round(delay)}ms${hinted}…`);
      },
    },
  ).catch((err: unknown) => {
    if (err instanceof RetryableHttpError) return err.response;
    throw err;
  });
}

/**
 * Fetch a bulk download (tarball / OpenAPI spec / llms-full / info archive)
 * with the body read INSIDE the retry loop.
 *
 * fetchWithRetry alone protects only the request up to response headers:
 * the returned Response's body is still tied to the per-attempt timeout
 * signal, so a stalled body rejects mid-read with undici's "terminated"
 * once the timeout fires - outside any retry, failing the whole source
 * (seen in CI: gitea-api's swagger download stalled on a GitHub runner
 * and died as "terminated" despite the upstream being healthy).
 *
 * Status classification matches fetchWithRetry: 4xx (except 413/429)
 * fails immediately via NonRetryableHttpError; 5xx/413/429 and body-read
 * failures are retried with backoff, honouring Retry-After.
 */
export async function fetchBufferWithRetry(
  url: string,
  retries = BULK_RETRIES,
  timeout = BULK_TIMEOUT,
  signal?: AbortSignal,
): Promise<Buffer> {
  return retryWithBackoff(
    async () => {
      // retries=0: fetchWithRetry still classifies statuses, but the outer
      // loop owns retrying so body-read errors are covered too.
      const res = await fetchWithRetry(url, 0, timeout, signal);
      if (!res.ok) {
        if (res.status < 500 && res.status !== 413 && res.status !== 429) {
          throw new NonRetryableHttpError(res.status, url);
        }
        throw new RetryableHttpError(`HTTP ${res.status} for ${url}`, res);
      }
      return Buffer.from(await res.arrayBuffer());
    },
    {
      retries,
      shouldRetry: (err) => !(err instanceof NonRetryableHttpError) && !signal?.aborted,
      delayFromError: (err) =>
        err instanceof RetryableHttpError ? err.retryAfterMs : undefined,
      onRetry: (_attempt, err, delay) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  [retry] ${url} -> ${msg}, waiting ${Math.round(delay)}ms...`);
      },
    },
  );
}
