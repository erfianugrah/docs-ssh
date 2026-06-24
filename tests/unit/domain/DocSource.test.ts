import { describe, it, expect } from "vitest";
import { DocSource } from "../../../src/domain/DocSource.js";

describe("DocSource", () => {
  it("constructs with valid config", () => {
    const src = new DocSource({
      name: "supabase",
      type: "git",
      format: "markdown",
      url: "https://github.com/supabase/supabase",
      paths: ["apps/docs/docs"],
    });
    expect(src.name).toBe("supabase");
    expect(src.type).toBe("git");
    expect(src.paths).toEqual(["apps/docs/docs"]);
  });

  it("throws if name is empty", () => {
    expect(
      () => new DocSource({ name: "", type: "git", format: "markdown", url: "https://x.com" }),
    ).toThrow("name must not be empty");
  });

  it("throws if url is empty", () => {
    expect(
      () => new DocSource({ name: "foo", type: "git", format: "markdown", url: "" }),
    ).toThrow("url must not be empty");
  });

  it("defaults paths and urls to empty arrays", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://x.com" });
    expect(src.paths).toEqual([]);
    expect(src.urls).toEqual([]);
  });

  it("equals returns true for same name and url", () => {
    const a = new DocSource({ name: "x", type: "git", format: "markdown", url: "https://x.com" });
    const b = new DocSource({ name: "x", type: "git", format: "mdx", url: "https://x.com" });
    expect(a.equals(b)).toBe(true);
  });

  it("equals returns false for different name", () => {
    const a = new DocSource({ name: "x", type: "git", format: "markdown", url: "https://x.com" });
    const b = new DocSource({ name: "y", type: "git", format: "markdown", url: "https://x.com" });
    expect(a.equals(b)).toBe(false);
  });

  it("leaves pageConcurrency and deadlineMs undefined by default", () => {
    const src = new DocSource({ name: "x", type: "http", format: "html", url: "https://x.com" });
    expect(src.pageConcurrency).toBeUndefined();
    expect(src.deadlineMs).toBeUndefined();
  });

  it("carries pageConcurrency and deadlineMs overrides through", () => {
    const src = new DocSource({
      name: "cloudflare-blog",
      type: "http",
      format: "html",
      url: "https://blog.cloudflare.com/",
      pageConcurrency: 4,
      deadlineMs: 1_800_000,
    });
    expect(src.pageConcurrency).toBe(4);
    expect(src.deadlineMs).toBe(1_800_000);
  });
});
