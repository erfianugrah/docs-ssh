import { describe, it, expect } from "vitest";
import { resolveDocusaurusImports } from "../../../src/normaliser/resolveDocusaurusImports.js";
import { DocFile } from "../../../src/domain/DocFile.js";

function mapOf(...files: [string, string][]): Map<string, DocFile> {
  return new Map(files.map(([p, c]) => [p, new DocFile(p, c)]));
}

describe("resolveDocusaurusImports", () => {
  it("inlines a Docusaurus site-absolute import and drops the partial", () => {
    const files = mapOf(
      ["quick-start.mdx", "import Steps from '/docs/partials/_steps.mdx';\n\nintro\n\n<Steps />\n\nend"],
      ["partials/_steps.mdx", "step content"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("quick-start.mdx")?.content).toBe("intro\n\nstep content\n\nend");
    expect(out.has("partials/_steps.mdx")).toBe(false);
    expect(out.size).toBe(1);
  });

  it("inlines a relative import", () => {
    const files = mapOf(
      ["guides/page.mdx", "import Foo from './_partial.mdx';\n<Foo /> end"],
      ["guides/_partial.mdx", "inlined"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("guides/page.mdx")?.content).toBe("inlined end");
  });

  it("inlines a ../ relative import", () => {
    const files = mapOf(
      ["sub/deep/page.mdx", "import Bar from '../_shared.mdx';\n<Bar />"],
      ["sub/_shared.mdx", "shared"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("sub/deep/page.mdx")?.content).toBe("shared");
  });

  it("inlines <Name></Name> paired tags", () => {
    const files = mapOf(
      ["page.mdx", "import Foo from '/docs/partials/_foo.mdx';\n<Foo></Foo>"],
      ["partials/_foo.mdx", "paired"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toBe("paired");
  });

  it("replaces all occurrences of the same component", () => {
    const files = mapOf(
      ["page.mdx", "import X from '/docs/partials/_x.mdx';\n<X /> then <X />"],
      ["partials/_x.mdx", "hi"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toBe("hi then hi");
  });

  it("handles multiple partials in one file", () => {
    const files = mapOf(
      ["page.mdx", "import A from '/docs/partials/_a.mdx';\nimport B from '/docs/partials/_b.mdx';\n<A /> and <B />"],
      ["partials/_a.mdx", "first"],
      ["partials/_b.mdx", "second"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toBe("first and second");
  });

  it("inlines partial content with markdown intact", () => {
    const files = mapOf(
      ["page.mdx", "import Steps from '/docs/partials/_steps.mdx';\n## Header\n\n<Steps />"],
      ["partials/_steps.mdx", "### Step 1\n\nDo this.\n\n### Step 2\n\nDo that."],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toContain("### Step 1");
    expect(out.get("page.mdx")?.content).toContain("### Step 2");
  });

  it("strips frontmatter from inlined partials", () => {
    const files = mapOf(
      ["page.mdx", "import Foo from '/docs/partials/_foo.mdx';\n<Foo />"],
      ["partials/_foo.mdx", "---\ntitle: Hidden\n---\nactual body"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toBe("actual body");
    expect(out.get("page.mdx")?.content).not.toContain("---");
  });

  it("leaves files without imports untouched", () => {
    const files = mapOf(
      ["page.mdx", "plain content\n\n## Heading\n\nmore"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toBe("plain content\n\n## Heading\n\nmore");
  });

  it("ignores external package imports (@theme, @mdi, etc.)", () => {
    const files = mapOf(
      ["page.mdx", "import Tabs from '@theme/Tabs';\nimport Icon from '@mdi/react';\n\n<Tabs>content</Tabs>"],
    );
    const out = resolveDocusaurusImports(files);
    // External imports and their tags pass through to MdxNormaliser.
    expect(out.get("page.mdx")?.content).toContain("import Tabs from '@theme/Tabs'");
    expect(out.get("page.mdx")?.content).toContain("<Tabs>");
  });

  it("ignores !!raw-loader imports", () => {
    const files = mapOf(
      ["page.mdx", "import ExampleEnv from '!!raw-loader!../../../docker/example.env';\n\ncontent"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).toContain("import ExampleEnv from '!!raw-loader!");
  });

  it("drops all partial files (basenames starting with _) from output", () => {
    const files = mapOf(
      ["page.mdx", "import X from '/docs/partials/_x.mdx';\n<X />"],
      ["partials/_x.mdx", "hi"],
      ["partials/_y.mdx", "unused"],
      ["keep.md", "standalone"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.has("partials/_x.mdx")).toBe(false);
    expect(out.has("partials/_y.mdx")).toBe(false);
    expect(out.has("page.mdx")).toBe(true);
    expect(out.has("keep.md")).toBe(true);
    expect(out.size).toBe(2);
  });

  it("drops the import line when resolving", () => {
    const files = mapOf(
      ["page.mdx", "import Foo from '/docs/partials/_foo.mdx';\nkeep this\n<Foo />"],
      ["partials/_foo.mdx", "body"],
    );
    const out = resolveDocusaurusImports(files);
    expect(out.get("page.mdx")?.content).not.toContain("import Foo");
    expect(out.get("page.mdx")?.content).toContain("keep this");
  });

  it("tolerates unresolvable imports (path missing)", () => {
    const files = mapOf(
      ["page.mdx", "import Gone from '/docs/partials/_missing.mdx';\n<Gone />"],
    );
    const out = resolveDocusaurusImports(files);
    // Import statement and tag survive for MdxNormaliser to strip.
    expect(out.get("page.mdx")?.content).toContain("import Gone");
    expect(out.get("page.mdx")?.content).toContain("<Gone />");
  });

  it("tolerates non-underscore local imports (not partials)", () => {
    const files = mapOf(
      ["page.mdx", "import AppArchitecture from './img/app-architecture.webp';\n\ncontent"],
      ["img/app-architecture.webp", "binary"],
    );
    const out = resolveDocusaurusImports(files);
    // Not a partial (doesn't start with _), so pass through.
    expect(out.get("page.mdx")?.content).toContain("import AppArchitecture");
  });
});