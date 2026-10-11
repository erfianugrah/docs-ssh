import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  collectIncidentIds,
  incidentToMarkdown,
  loadCarriedArchive,
  mergeCarriedArchive,
  updateToText,
  type IncidentioIncident,
  type IncidentioUpdate,
} from "../../../src/ingestors/incidentio-converter.js";
import { DocFile } from "../../../src/domain/DocFile.js";

// Fixture trimmed from a REAL status.supabase.com payload (fetched
// 2026-10-11): the "Statuspage Migration" maintenance incident, three
// updates, text_node trees stripped.
const FIXTURE = path.join(__dirname, "../../fixtures/incidentio-incident.json");

async function loadFixture(): Promise<IncidentioIncident> {
  return JSON.parse(await fs.readFile(FIXTURE, "utf-8")) as IncidentioIncident;
}

const BASE = "https://status.supabase.com";
const ID = "01M3T5X0M7MY87TX29CFN1HCJS";

/** Expected timeline heading for an update (ms trimmed). */
function headingFor(u: IncidentioUpdate): string {
  const ts = (u.published_at ?? "").replace(/\.\d+Z$/, "Z");
  return `### ${u.to_status ?? "update"} - ${ts}`;
}

describe("updateToText", () => {
  it("prefers message_string", () => {
    const u: IncidentioUpdate = {
      message_string: "plain text",
      message: { markdown: "**markdown**" },
    };
    expect(updateToText(u)).toBe("plain text");
  });

  it("falls back to message.markdown", () => {
    const u: IncidentioUpdate = { message: { markdown: "**markdown**" } };
    expect(updateToText(u)).toBe("**markdown**");
  });

  it("derives text from the text_node tree as a last resort", () => {
    const u: IncidentioUpdate = {
      message: {
        text_node: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "first" }] },
            { type: "paragraph", content: [{ type: "text", text: "second" }] },
          ],
        },
      },
    };
    expect(updateToText(u)).toBe("first\n\nsecond");
  });

  it("returns empty string when nothing is present", () => {
    expect(updateToText({})).toBe("");
  });
});

describe("incidentToMarkdown", () => {
  let incident: IncidentioIncident;
  beforeAll(async () => {
    incident = await loadFixture();
  });

  it("emits an incidents/<id>.md file", () => {
    const f = incidentToMarkdown(incident, ID, BASE);
    expect(f.path).toBe(`incidents/${ID}.md`);
  });

  it("uses the incident name as H1 and a compact metadata block", () => {
    const { content } = incidentToMarkdown(incident, ID, BASE);
    expect(content).toContain("# Statuspage Migration");
    expect(content).toContain("**Status:** maintenance_complete");
    expect(content).toContain("**Type:** maintenance");
    expect(content).toContain("**Published:** 2026-09-30T22:08:26Z"); // ms trimmed
  });

  it("renders the timeline oldest-first with to_status headings", () => {
    const { content } = incidentToMarkdown(incident, ID, BASE);
    expect(content).toContain("## Timeline");
    const positions = (incident.updates ?? []).map((u) => content.indexOf(headingFor(u)));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    // Chronological order: each heading after the previous one.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    expect(content).toContain("Starting October 7th, we are migrating our status page");
  });

  it("sorts updates chronologically when the payload order differs", () => {
    const shuffled: IncidentioIncident = {
      ...incident,
      updates: [...incident.updates!].reverse(),
    };
    const { content } = incidentToMarkdown(shuffled, ID, BASE);
    const first = content.indexOf(headingFor(incident.updates![0]));
    const last = content.indexOf(headingFor(incident.updates![incident.updates!.length - 1]));
    expect(first).toBeGreaterThan(-1);
    expect(last).toBeGreaterThan(first);
  });

  it("lists affected components by impact status when present", () => {
    const withImpacts: IncidentioIncident = {
      ...incident,
      component_impacts: [
        { component_id: "a1", status: "full_outage" },
        { component_id: "b2", status: "degraded_performance" },
      ],
    };
    const { content } = incidentToMarkdown(withImpacts, ID, BASE);
    expect(content).toContain("**Affected components:** 2 (full_outage, degraded_performance)");
  });

  it("omits the affected-components line when there are no impacts", () => {
    const { content } = incidentToMarkdown(incident, ID, BASE);
    expect(content).not.toContain("Affected components");
  });
});

describe("collectIncidentIds", () => {
  it("extracts de-duplicated ids from a list payload", async () => {
    const list = JSON.parse(
      await fs.readFile(path.join(__dirname, "../../fixtures/incidentio-list.json"), "utf-8"),
    );
    expect(collectIncidentIds(list)).toEqual([
      "01M3T5X0M7MY87TX29CFN1HCJS",
      "01M48WZN5HSPR8TG7AT83XRS1K",
      "01M3PZTHHR2P5PR1WRCZ36EDVV",
    ]);
  });

  it("skips entries without an id and returns [] for an empty list", () => {
    expect(collectIncidentIds({ incidents: [{ name: "no id" }, { id: "x" }, { id: "x" }] })).toEqual(["x"]);
    expect(collectIncidentIds({})).toEqual([]);
  });
});

describe("loadCarriedArchive + mergeCarriedArchive", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "incidentio-carry-"));
    await fs.writeFile(path.join(dir, "oldcode1.md"), "# Old incident one\n");
    await fs.mkdir(path.join(dir, "incidents"), { recursive: true });
    await fs.writeFile(path.join(dir, "incidents/oldcode2.md"), "# Old incident two\n");
    await fs.writeFile(
      path.join(dir, ".stamp.json"),
      JSON.stringify({
        fetchedAt: "2026-10-01T00:00:00Z",
        origins: {
          "oldcode1.md": "https://status.supabase.com/incidents/oldcode1",
          "incidents/oldcode2.md": "https://status.supabase.com/incidents/oldcode2",
        },
      }),
    );
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads every *.md with origin URLs from the previous stamp", async () => {
    const carried = await loadCarriedArchive(dir);
    expect([...carried.keys()].sort()).toEqual(["incidents/oldcode2.md", "oldcode1.md"]);
    expect(carried.get("oldcode1.md")?.content).toBe("# Old incident one\n");
    expect(carried.get("oldcode1.md")?.originUrl).toBe("https://status.supabase.com/incidents/oldcode1");
    expect(carried.get("incidents/oldcode2.md")?.originUrl).toBe(
      "https://status.supabase.com/incidents/oldcode2",
    );
  });

  it("fresh wins on collision; non-overlapping files are carried", () => {
    const fresh = new Map<string, DocFile>([
      // Same path as a carried file, newer content.
      [
        "oldcode1.md",
        new DocFile("oldcode1.md", "# Fresh content\n", {
          originUrl: "https://status.supabase.com/incidents/oldcode1",
        }),
      ],
      ["incidents/new1.md", new DocFile("incidents/new1.md", "# New\n")],
    ]);
    const carried = new Map<string, DocFile>([
      ["oldcode1.md", new DocFile("oldcode1.md", "# Old incident one\n")],
      ["incidents/oldcode2.md", new DocFile("incidents/oldcode2.md", "# Old incident two\n")],
    ]);
    const { files, carriedCount } = mergeCarriedArchive(fresh, carried);
    expect(carriedCount).toBe(1);
    expect(files.size).toBe(3);
    expect(files.get("oldcode1.md")?.content).toBe("# Fresh content\n");
    expect(files.get("incidents/oldcode2.md")?.content).toBe("# Old incident two\n");
    expect(files.get("incidents/new1.md")?.content).toBe("# New\n");
  });

  it("returns an empty map for a missing dir", async () => {
    const carried = await loadCarriedArchive(path.join(dir, "does-not-exist"));
    expect(carried.size).toBe(0);
  });

  it("carries files without a stamp (no origins)", async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), "incidentio-bare-"));
    try {
      await fs.writeFile(path.join(bare, "a.md"), "# A\n");
      const carried = await loadCarriedArchive(bare);
      expect(carried.size).toBe(1);
      expect(carried.get("a.md")?.originUrl).toBeUndefined();
    } finally {
      await fs.rm(bare, { recursive: true, force: true });
    }
  });
});
