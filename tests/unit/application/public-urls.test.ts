import { describe, it, expect } from "vitest";
import { lexicanumPublicUrl } from "../../../src/application/public-urls.js";

describe("lexicanumPublicUrl (erfi-technical-blog)", () => {
  it("maps a guide to its published slug (lowercased)", () => {
    expect(lexicanumPublicUrl("src/content/docs/guides/supabase-shared-tenancy.mdx")).toBe(
      "https://erfi.dev/guides/supabase-shared-tenancy/",
    );
  });

  it("maps the root index to the site root", () => {
    expect(lexicanumPublicUrl("src/content/docs/index.mdx")).toBe("https://erfi.dev/");
  });

  it("maps a nested index to its directory", () => {
    expect(lexicanumPublicUrl("src/content/docs/reference/index.mdx")).toBe(
      "https://erfi.dev/reference/",
    );
    expect(lexicanumPublicUrl("src/content/docs/guides/Index.md")).toBe(
      "https://erfi.dev/guides/",
    );
  });

  it("handles .md as well as .mdx", () => {
    expect(lexicanumPublicUrl("src/content/docs/reference/foo.md")).toBe(
      "https://erfi.dev/reference/foo/",
    );
  });

  it("lowercases mixed-case paths", () => {
    expect(lexicanumPublicUrl("src/content/docs/Guides/Foo-Bar.mdx")).toBe(
      "https://erfi.dev/guides/foo-bar/",
    );
  });

  it("returns undefined outside the docs tree", () => {
    expect(lexicanumPublicUrl("src/pages/index.astro")).toBeUndefined();
    expect(lexicanumPublicUrl("README.md")).toBeUndefined();
  });
});
