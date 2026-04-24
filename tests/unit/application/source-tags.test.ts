import { describe, it, expect } from "vitest";
import { SOURCES } from "../../../src/application/sources.js";
import { SOURCE_TAGS, TAG_LABELS, buildSourceGroups } from "../../../src/application/source-tags.js";

describe("SOURCE_TAGS", () => {
  it("every source in SOURCES has at least one tag", () => {
    const untagged = SOURCES.filter((s) => !SOURCE_TAGS[s.name]);
    expect(
      untagged.map((s) => s.name),
      `untagged sources: ${untagged.map((s) => s.name).join(", ")}`,
    ).toHaveLength(0);
  });

  it("every tagged name corresponds to an actual source", () => {
    const sourceNames = new Set(SOURCES.map((s) => s.name));
    const orphaned = Object.keys(SOURCE_TAGS).filter((n) => !sourceNames.has(n));
    expect(
      orphaned,
      `tags reference non-existent sources: ${orphaned.join(", ")}`,
    ).toHaveLength(0);
  });

  it("every tag used in SOURCE_TAGS has a label in TAG_LABELS", () => {
    const allTags = new Set(Object.values(SOURCE_TAGS).flat());
    const unlabeled = [...allTags].filter((t) => !TAG_LABELS[t]);
    expect(
      unlabeled,
      `tags without labels: ${unlabeled.join(", ")}`,
    ).toHaveLength(0);
  });
});

describe("buildSourceGroups", () => {
  it("returns a non-empty map", () => {
    const groups = buildSourceGroups();
    expect(groups.size).toBeGreaterThan(0);
  });

  it("includes databases group with postgres", () => {
    const groups = buildSourceGroups();
    const db = groups.get("databases");
    expect(db).toBeDefined();
    expect(db).toContain("postgres");
  });

  it("includes postgres-ecosystem group", () => {
    const groups = buildSourceGroups();
    const pg = groups.get("postgres-ecosystem");
    expect(pg).toBeDefined();
    expect(pg!.length).toBeGreaterThan(5);
  });

  it("sources can appear in multiple groups", () => {
    const groups = buildSourceGroups();
    const supabaseGroups = [...groups.entries()]
      .filter(([, names]) => names.includes("supabase"))
      .map(([tag]) => tag);
    expect(supabaseGroups.length).toBeGreaterThan(1);
  });
});
