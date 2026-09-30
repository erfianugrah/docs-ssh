import { describe, it, expect } from "vitest";
import { WARM_MAX_AGE, parseLastFetch, planBuild } from "../../../src/ci/build-plan.js";

const now = new Date("2026-10-01T02:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const last = (h: number) => ({ fetchedAt: hoursAgo(h), commit: "abc1234def" });

describe("planBuild", () => {
  it("empty cache: fetch on every event", () => {
    for (const event of ["tag", "schedule", "dispatch"] as const) {
      const p = planBuild({ event, forceRefresh: false, last: null, fetcherChanged: null, now });
      expect(p).toMatchObject({ build: true, fetch: true, docsMaxAge: WARM_MAX_AGE });
    }
  });

  it("schedule after a release fetched 16h ago: skip the whole run", () => {
    const p = planBuild({ event: "schedule", forceRefresh: false, last: last(16), fetcherChanged: false, now });
    expect(p).toMatchObject({ build: false, fetch: false });
    expect(p.reason).toContain("16.0h");
  });

  it("schedule with day-old docs: warm fetch", () => {
    const p = planBuild({ event: "schedule", forceRefresh: false, last: last(23.5), fetcherChanged: false, now });
    expect(p).toMatchObject({ build: true, fetch: true, docsMaxAge: WARM_MAX_AGE });
  });

  it("code-only release on fresh docs: build without fetching", () => {
    const p = planBuild({ event: "tag", forceRefresh: false, last: last(3), fetcherChanged: false, now });
    expect(p).toMatchObject({ build: true, fetch: false });
  });

  it("release that changed fetcher code: full refetch even when fresh", () => {
    const p = planBuild({ event: "tag", forceRefresh: false, last: last(1), fetcherChanged: true, now });
    expect(p).toMatchObject({ build: true, fetch: true, docsMaxAge: 0 });
    expect(p.reason).toContain("abc1234");
  });

  it("schedule also refetches after unreleased fetcher changes on main", () => {
    const p = planBuild({ event: "schedule", forceRefresh: false, last: last(2), fetcherChanged: true, now });
    expect(p).toMatchObject({ build: true, fetch: true, docsMaxAge: 0 });
  });

  it("unknown diff (commit not in history) counts as changed", () => {
    const p = planBuild({ event: "tag", forceRefresh: false, last: last(1), fetcherChanged: null, now });
    expect(p).toMatchObject({ fetch: true, docsMaxAge: 0 });
  });

  it("manual refresh forces a full refetch", () => {
    const p = planBuild({ event: "dispatch", forceRefresh: true, last: last(1), fetcherChanged: false, now });
    expect(p).toMatchObject({ build: true, fetch: true, docsMaxAge: 0 });
  });

  it("unreadable fetchedAt: fetch", () => {
    const p = planBuild({
      event: "schedule",
      forceRefresh: false,
      last: { fetchedAt: "garbage", commit: "x" },
      fetcherChanged: false,
      now,
    });
    expect(p.fetch).toBe(true);
  });
});

describe("parseLastFetch", () => {
  it("parses a valid record", () => {
    expect(parseLastFetch('{"fetchedAt":"2026-09-30T02:00:00Z","commit":"abc","reason":"x"}')).toEqual({
      fetchedAt: "2026-09-30T02:00:00Z",
      commit: "abc",
    });
  });
  it("returns null for empty, malformed or incomplete input", () => {
    expect(parseLastFetch("")).toBeNull();
    expect(parseLastFetch("{nope")).toBeNull();
    expect(parseLastFetch('{"fetchedAt":"x"}')).toBeNull();
  });
});
