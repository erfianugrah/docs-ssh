import { describe, it, expect } from "vitest";
import { resolvePartials } from "../../../src/normaliser/resolvePartials.js";
import { DocFile } from "../../../src/domain/DocFile.js";

function mapOf(...files: [string, string][]): Map<string, DocFile> {
  return new Map(files.map(([p, c]) => [p, new DocFile(p, c)]));
}

describe("resolvePartials", () => {
  it("inlines a bare-filename partial relative to _partials/", () => {
    const files = mapOf(
      ["guides/x.mdx", "intro\n\n<$Partial path=\"warn.mdx\" />\n\nend"],
      ["_partials/warn.mdx", "be careful"],
    );
    const out = resolvePartials(files);
    expect(out.get("guides/x.mdx")?.content).toBe("intro\n\nbe careful\n\nend");
  });

  it("inlines a subdirectory partial path", () => {
    const files = mapOf(
      ["guides/x.mdx", "<$Partial path=\"billing/pricing/p.mdx\" />"],
      ["_partials/billing/pricing/p.mdx", "$10/mo"],
    );
    expect(resolvePartials(files).get("guides/x.mdx")?.content).toBe("$10/mo");
  });

  it("tolerates single quotes and a leading slash", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path='/sub/n.mdx' />"],
      ["_partials/sub/n.mdx", "nested body"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("nested body");
  });

  it("handles multi-line directives", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial\n  path=\"w.mdx\"\n/>"],
      ["_partials/w.mdx", "X"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("X");
  });

  it("resolves nested partials recursively", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path=\"one.mdx\" />"],
      ["_partials/one.mdx", "first <$Partial path=\"two.mdx\" />"],
      ["_partials/two.mdx", "second"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("first second");
  });

  it("substitutes provided variables", () => {
    const files = mapOf(
      ["a.mdx", '<$Partial path="t.mdx" variables={{ "framework": "astro" }} />'],
      ["_partials/t.mdx", "Use {{ .framework }} now"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("Use astro now");
  });

  it("clears unprovided placeholders", () => {
    const files = mapOf(
      ["a.mdx", '<$Partial path="t.mdx" />'],
      ["_partials/t.mdx", "Use {{ .framework }}done"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("Use done");
  });

  it("drops _partials/** from the served set", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path=\"w.mdx\" />"],
      ["_partials/w.mdx", "body"],
    );
    const out = resolvePartials(files);
    expect(out.has("_partials/w.mdx")).toBe(false);
    expect(out.has("a.mdx")).toBe(true);
  });

  it("drops the directive when the partial is missing", () => {
    const files = mapOf(["a.mdx", "before <$Partial path=\"gone.mdx\" /> after"]);
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("before  after");
  });

  it("rejects path traversal escaping _partials/", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path=\"../../etc/secret.mdx\" />"],
      ["etc/secret.mdx", "SECRET"],
    );
    // Directive dropped; secret not inlined.
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("");
  });

  it("strips frontmatter from an inlined partial", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path=\"w.mdx\" />"],
      ["_partials/w.mdx", "---\ntitle: X\n---\nactual body"],
    );
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("actual body");
  });

  it("leaves files without directives untouched", () => {
    const files = mapOf(["a.mdx", "plain content"]);
    expect(resolvePartials(files).get("a.mdx")?.content).toBe("plain content");
  });

  it("terminates on a partial cycle without throwing", () => {
    const files = mapOf(
      ["a.mdx", "<$Partial path=\"loop.mdx\" />"],
      ["_partials/loop.mdx", "x <$Partial path=\"loop.mdx\" />"],
    );
    // Should not hang or throw; depth cap halts recursion.
    expect(() => resolvePartials(files)).not.toThrow();
    expect(out_a(files)).toContain("x");
  });
});

function out_a(files: Map<string, DocFile>): string {
  return resolvePartials(files).get("a.mdx")?.content ?? "";
}
