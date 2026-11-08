import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneRemovedSources } from "../../../src/application/prune-sources.js";

describe("pruneRemovedSources", () => {
  it("removes directories of sources that are no longer configured", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
    for (const d of ["seerr", "jellyseerr", "_private", ".git"]) fs.mkdirSync(path.join(dir, d));
    fs.writeFileSync(path.join(dir, "jellyseerr", "a.md"), "# a");
    fs.writeFileSync(path.join(dir, "_origins.tsv"), "");
    expect(await pruneRemovedSources(dir, new Set(["seerr"]))).toEqual(["jellyseerr"]);
    expect(fs.readdirSync(dir).sort()).toEqual([".git", "_origins.tsv", "_private", "seerr"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing with an empty source list or a missing dir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
    fs.mkdirSync(path.join(dir, "postgres"));
    expect(await pruneRemovedSources(dir, new Set())).toEqual([]);
    expect(fs.existsSync(path.join(dir, "postgres"))).toBe(true);
    expect(await pruneRemovedSources("/nonexistent/docs-ssh-prune", new Set(["x"]))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
