/**
 * Decides what one run of .forgejo/workflows/build.yml does.
 *
 * Releases (tag), the daily schedule and manual runs all build the same
 * artefact - code at a ref plus a docs tree - so they share one question:
 * are the docs in the persistent cache still good enough? The cache records
 * when its docs were last fetched and at which commit (docs/_build.json),
 * and every run that fetches rewrites that record. That single fact breaks
 * the release-vs-daily circularity: a release that fetched at 10:00 makes
 * the next 02:00 schedule skip, and a code-only release never refetches.
 */

export type BuildEvent = "tag" | "schedule" | "dispatch";

export interface LastFetch {
  /** ISO time the last successful fetch STARTED. */
  fetchedAt: string;
  /** Commit the fetch ran at. */
  commit: string;
}

export interface PlanInput {
  event: BuildEvent;
  /** Manual `refresh: true` - refetch every source. */
  forceRefresh: boolean;
  /** Parsed docs/_build.json from the cache, or null when the cache is empty. */
  last: LastFetch | null;
  /**
   * Did fetcher code change between `last.commit` and the ref being built?
   * null = could not tell (commit not in history), treated as changed.
   */
  fetcherChanged: boolean | null;
  now: Date;
  /** Docs older than this are refetched. Default 20h (daily cadence minus slack). */
  maxAgeHours?: number;
}

export interface BuildPlan {
  /** Build + push + deploy at all. False only for a schedule run with fresh docs. */
  build: boolean;
  /** Run pnpm fetch-docs before building. */
  fetch: boolean;
  /** DOCS_MAX_AGE for the fetch: 0 refetches every source, WARM_MAX_AGE lets fresh sources skip. */
  docsMaxAge: number;
  reason: string;
}

/** Per-source trust window on a warm cache (36h, what the old Composer pipeline used). */
export const WARM_MAX_AGE = 129_600;

/** Paths whose change alters fetch output, so cached docs are stale regardless of age. */
export const FETCHER_PATHS = [
  "src/ingestors",
  "src/normaliser",
  "src/application",
  "src/domain",
  "src/shared",
  "src/index.ts",
  "package.json",
  "pnpm-lock.yaml",
] as const;

export function planBuild(input: PlanInput): BuildPlan {
  const maxAgeHours = input.maxAgeHours ?? 20;
  const fetchPlan = (docsMaxAge: number, reason: string): BuildPlan => ({
    build: true,
    fetch: true,
    docsMaxAge,
    reason,
  });

  if (input.forceRefresh) return fetchPlan(0, "manual refresh requested");
  if (!input.last) return fetchPlan(WARM_MAX_AGE, "docs cache is empty");

  const fetchedAt = new Date(input.last.fetchedAt).getTime();
  if (Number.isNaN(fetchedAt)) return fetchPlan(WARM_MAX_AGE, "docs cache record is unreadable");

  if (input.fetcherChanged !== false) {
    return fetchPlan(
      0,
      input.fetcherChanged === null
        ? `cannot diff fetcher code against ${input.last.commit.slice(0, 7)}`
        : `fetcher code changed since ${input.last.commit.slice(0, 7)}`,
    );
  }

  const ageHours = (input.now.getTime() - fetchedAt) / 3_600_000;
  if (ageHours >= maxAgeHours) {
    return fetchPlan(WARM_MAX_AGE, `docs are ${ageHours.toFixed(1)}h old (>= ${maxAgeHours}h)`);
  }

  const fresh = `docs are ${ageHours.toFixed(1)}h old (< ${maxAgeHours}h)`;
  if (input.event === "schedule") {
    return { build: false, fetch: false, docsMaxAge: WARM_MAX_AGE, reason: `${fresh}; nothing to do` };
  }
  return { build: true, fetch: false, docsMaxAge: WARM_MAX_AGE, reason: `${fresh}; build on cached docs` };
}

/** Parse docs/_build.json text; null for empty / malformed input. */
export function parseLastFetch(text: string): LastFetch | null {
  if (!text.trim()) return null;
  try {
    const v = JSON.parse(text) as Partial<LastFetch>;
    if (typeof v.fetchedAt !== "string" || typeof v.commit !== "string") return null;
    return { fetchedAt: v.fetchedAt, commit: v.commit };
  } catch {
    return null;
  }
}
