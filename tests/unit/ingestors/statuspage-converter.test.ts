import { describe, it, expect } from "vitest";
import {
  cleanBody,
  collectIncidentCodes,
  incidentToMarkdown,
  type StatuspageIncident,
} from "../../../src/ingestors/statuspage-converter.js";

const BASE = "https://status.supabase.com";

describe("cleanBody", () => {
  it("converts anchor tags to markdown links", () => {
    expect(cleanBody('See <a href="https://x.io/p">the settings</a> now.')).toBe(
      "See [the settings](https://x.io/p) now.",
    );
  });

  it("strips stray tags and decodes entities", () => {
    expect(cleanBody("A &amp; B <b>bold</b> &lt;tag&gt;")).toBe("A & B bold <tag>");
  });

  it("collapses excess blank lines and trims", () => {
    expect(cleanBody("\n\nline1\n\n\n\nline2\n\n")).toBe("line1\n\nline2");
  });

  it("returns empty string for falsy input", () => {
    expect(cleanBody("")).toBe("");
  });
});

describe("incidentToMarkdown", () => {
  const incident: StatuspageIncident = {
    code: "abc123",
    name: "Degraded project creation in ca-central-1",
    impact: "minor",
    status: "resolved",
    shortlink: "https://stspg.io/xyz",
    started_at: "2026-07-02T22:59:32.860Z",
    resolved_at: "2026-07-03T04:51:21.807Z",
    components: [{ name: "ca-central-1" }, { name: "API" }],
    incident_updates: [
      { status: "resolved", body: "Restored.", created_at: "2026-07-03T04:51:21.807Z" },
      { status: "investigating", body: "Looking into it.", created_at: "2026-07-02T22:59:32.966Z" },
    ],
  };

  it("emits a <code>.md file", () => {
    const f = incidentToMarkdown(incident, "abc123", BASE);
    expect(f.path).toBe("abc123.md");
  });

  it("writes frontmatter with code, impact, status, dates and components", () => {
    const { content } = incidentToMarkdown(incident, "abc123", BASE);
    expect(content).toContain("code: abc123");
    expect(content).toContain("impact: minor");
    expect(content).toContain("status: resolved");
    expect(content).toContain("created_at: 2026-07-02T22:59:32Z"); // ms trimmed
    expect(content).toContain("resolved_at: 2026-07-03T04:51:21Z");
    expect(content).toContain("components: [ca-central-1, API]");
    expect(content).toContain("page: https://status.supabase.com/incidents/abc123");
  });

  it("renders the timeline oldest-first (investigating before resolved)", () => {
    const { content } = incidentToMarkdown(incident, "abc123", BASE);
    const invIdx = content.indexOf("### investigating");
    const resIdx = content.indexOf("### resolved");
    expect(invIdx).toBeGreaterThan(-1);
    expect(resIdx).toBeGreaterThan(invIdx);
  });

  it("includes a postmortem section when present", () => {
    const withPm: StatuspageIncident = {
      ...incident,
      postmortem_body: "<p>Root cause was a bad deploy.</p>",
      postmortem_published_at: "2026-07-04T00:00:00.000Z",
    };
    const { content } = incidentToMarkdown(withPm, "abc123", BASE);
    expect(content).toContain("## Postmortem");
    expect(content).toContain("Root cause was a bad deploy.");
    expect(content).toContain("_Published 2026-07-04T00:00:00Z_");
  });

  it("omits the postmortem section when absent", () => {
    const { content } = incidentToMarkdown(incident, "abc123", BASE);
    expect(content).not.toContain("## Postmortem");
  });

  it("quotes YAML names containing colons", () => {
    const tricky: StatuspageIncident = { ...incident, name: "Outage: everything down" };
    const { content } = incidentToMarkdown(tricky, "abc123", BASE);
    expect(content).toContain('name: "Outage: everything down"');
  });
});

describe("collectIncidentCodes", () => {
  it("paginates until an empty page and dedupes codes newest-first", async () => {
    const pages: Record<number, unknown> = {
      1: { months: [{ name: "July", incidents: [{ code: "c1" }, { code: "c2" }] }] },
      2: { months: [{ name: "April", incidents: [{ code: "c2" }, { code: "c3" }] }] }, // c2 dup
      3: { months: [{ name: "January", incidents: [] }] }, // empty -> stop
    };
    const fetchJson = async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return pages[page] ?? { months: [] };
    };
    const codes = await collectIncidentCodes(BASE, fetchJson);
    expect(codes).toEqual(["c1", "c2", "c3"]);
  });

  it("honours the maxPages safety valve", async () => {
    // Upstream that never returns an empty page.
    let calls = 0;
    const fetchJson = async () => {
      calls++;
      return { months: [{ name: "x", incidents: [{ code: `c${calls}` }] }] };
    };
    const codes = await collectIncidentCodes(BASE, fetchJson, 5);
    expect(codes).toHaveLength(5);
    expect(calls).toBe(5);
  });
});
