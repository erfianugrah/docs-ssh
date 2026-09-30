import { describe, it, expect } from "vitest";
import { repoBrowseUrl } from "../../../src/shared/origin-url.js";

describe("repoBrowseUrl", () => {
  it("github uses /blob/HEAD/", () => {
    expect(repoBrowseUrl("https://github.com/supabase/supabase", "apps/docs/content/index.mdx")).toBe(
      "https://github.com/supabase/supabase/blob/HEAD/apps/docs/content/index.mdx",
    );
  });

  it("strips a trailing .git", () => {
    expect(repoBrowseUrl("https://github.com/foo/bar.git", "docs/x.md")).toBe(
      "https://github.com/foo/bar/blob/HEAD/docs/x.md",
    );
  });

  it("gitlab uses /-/blob/HEAD/", () => {
    expect(repoBrowseUrl("https://gitlab.com/foo/bar", "docs/x.md")).toBe(
      "https://gitlab.com/foo/bar/-/blob/HEAD/docs/x.md",
    );
  });

  it("codeberg uses /src/branch/<branch>/", () => {
    expect(repoBrowseUrl("https://codeberg.org/foo/bar", "docs/x.md", "main")).toBe(
      "https://codeberg.org/foo/bar/src/branch/main/docs/x.md",
    );
  });

  it("gitea/forgejo hosts use /src/branch/<branch>/ and fall back to HEAD", () => {
    expect(repoBrowseUrl("https://gitea.example.com/erfi/docs", "docs/x.md", "trunk")).toBe(
      "https://gitea.example.com/erfi/docs/src/branch/trunk/docs/x.md",
    );
    expect(repoBrowseUrl("https://forgejo.example.com/o/r", "a.md")).toBe(
      "https://forgejo.example.com/o/r/src/branch/HEAD/a.md",
    );
  });

  it("known bare-hostname gitea instances use /src/branch/", () => {
    expect(repoBrowseUrl("https://git.deuxfleurs.fr/Deuxfleurs/garage", "doc/book/x.md", "main")).toBe(
      "https://git.deuxfleurs.fr/Deuxfleurs/garage/src/branch/main/doc/book/x.md",
    );
  });

  it("unknown host yields no URL", () => {
    expect(repoBrowseUrl("https://example.com/foo/bar", "docs/x.md")).toBeUndefined();
  });

  it("unparseable URL yields no URL", () => {
    expect(repoBrowseUrl("not a url", "docs/x.md")).toBeUndefined();
  });

  it("empty repo path yields no URL", () => {
    expect(repoBrowseUrl("https://github.com/foo/bar", "")).toBeUndefined();
  });
});
