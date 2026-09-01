import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { convertTrashGuides } from "../../../src/ingestors/trash-guides-converter.js";

function hasJinja2(): boolean {
  try {
    execFileSync("python3", ["-c", "import jinja2"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a minimal TRaSH-Guides checkout on disk:
 *   <root>/docs/Sonarr/naming.md         (markdown with all 4 directive kinds)
 *   <root>/docs/json/sonarr/naming/sonarr-naming.json  (markdownextradata data)
 *   <root>/includes/support.md            (repo-root snippet, contains {{ }})
 *   <root>/includes/starr/faq.md          (nested include target)
 */
let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "trash-guides-test-"));
  fs.mkdirSync(path.join(root, "docs", "Sonarr"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "Radarr"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "json", "sonarr", "naming"), { recursive: true });
  fs.mkdirSync(path.join(root, "includes", "starr"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "docs", "json", "sonarr", "naming", "sonarr-naming.json"),
    JSON.stringify({
      season: { default: "Season {season:00}" },
      episodes: {
        standard: { default: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle}" },
      },
    }),
  );

  fs.writeFileSync(
    path.join(root, "includes", "support.md"),
    "Support via {{ sonarr['naming']['sonarr-naming']['season']['default'] }}.\n",
  );

  fs.writeFileSync(
    path.join(root, "includes", "starr", "faq.md"),
    "FAQ body.\n",
  );

  fs.writeFileSync(
    path.join(root, "docs", "Radarr", "shared-tip.md"),
    "Shared tip body.\n",
  );

  fs.writeFileSync(
    path.join(root, "docs", "Sonarr", "naming.md"),
    [
      "# Naming",
      "",
      "```bash",
      "{{ sonarr['naming']['sonarr-naming']['episodes']['standard']['default'] }}",
      "```",
      "",
      "--8<-- \"includes/support.md\"",
      "",
      "{! include-markdown \"../../includes/starr/faq.md\" !}",
      "",
      "{! include-markdown '../Radarr/shared-tip.md' !}",
      "",
      "```json",
      "[[% filter indent(width=4) %]][[% include 'json/sonarr/naming/sonarr-naming.json' %]][[% endfilter %]]",
      "```",
      "",
      "missing key stays: {{ sonarr['naming']['does-not-exist'] }}",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("convertTrashGuides", () => {
  it("resolves all four directive kinds", async () => {
    const files = await convertTrashGuides(root);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));

    expect(Object.keys(byPath).sort()).toEqual(["Radarr/shared-tip.md", "Sonarr/naming.md"]);

    const out = byPath["Sonarr/naming.md"];

    // 4. markdownextradata {{ }} lookup
    expect(out).toContain(
      "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle}",
    );

    // 1. pymdownx.snippets --8<-- (repo-root includes), with nested {{ }}
    expect(out).toContain("Support via Season {season:00}.");

    // 2. include-markdown, relative to the including file's dir
    expect(out).toContain("FAQ body.");

    // single-quoted include-markdown targeting another docs page
    expect(out).toContain("Shared tip body.");

    // 3. mkdocs-macros [[% include %]] + [[% filter indent %]]
    expect(out).toContain('"episodes"');
    expect(out).not.toContain("[[%");

    // unresolved lookups keep the token (no silent data loss)
    expect(out).toContain("{{ sonarr['naming']['does-not-exist'] }}");
    expect(out).not.toContain("--8<--");
    expect(out).not.toContain("{! include-markdown");
  });

  it("does not walk json data files into the served set", async () => {
    const files = await convertTrashGuides(root);
    expect(files.some((f) => f.path.endsWith(".json"))).toBe(false);
    expect(files.some((f) => f.path.startsWith("includes/"))).toBe(false);
  });
});

// Real-binary integration: the two Guide-Sync pages are full Jinja templates
// rendered through the bundled python3+jinja2 helper. Skipped when jinja2 is
// unavailable (e.g. a minimal CI runner) so it never fails spuriously; the
// Docker daily-refresh + release fetch both install jinja2 and exercise this.
const fullJinja = hasJinja2() ? describe : describe.skip;

fullJinja("full Jinja control-flow templates", () => {
  let jroot: string;

  beforeAll(() => {
    jroot = fs.mkdtempSync(path.join(os.tmpdir(), "trash-guides-jinja-"));
    fs.mkdirSync(path.join(jroot, "docs", "Guide-Sync"), { recursive: true });
    fs.mkdirSync(path.join(jroot, "docs", "json", "sonarr", "cf-groups"), { recursive: true });

    fs.writeFileSync(
      path.join(jroot, "docs", "json", "sonarr", "cf-groups", "audio.json"),
      JSON.stringify({
        name: "[Audio] Audio Formats",
        trash_id: "aaa111",
        trash_description: "Lossless formats.<br>Second line.",
        custom_formats: [
          { name: "TrueHD ATMOS", trash_id: "bbb222", required: true },
          { name: "FLAC", trash_id: "ccc333", required: false },
        ],
      }),
    );

    // A trimmed version of the real Guide-Sync template exercising the
    // Python-isms: macro + cf_slug, namespace(), .split, |dictsort, is defined.
    fs.writeFileSync(
      path.join(jroot, "docs", "Guide-Sync", "sonarr-cf-groups.md"),
      [
        "# Custom Format Groups",
        "",
        "{%- macro cf_slug(name) -%}{{ name | lower | replace(' ', '-') }}{%- endmacro -%}",
        "{% set ns = namespace(current_category='') -%}",
        "{% for key, group in sonarr['cf-groups']|dictsort -%}",
        "{% set category = group['name'].split(']')[0][1:] -%}",
        "{% if category != ns.current_category -%}",
        "{% set ns.current_category = category -%}",
        "## {{ category }}",
        "{% endif -%}",
        "### {{ group['name'].split('] ')[1] }}",
        "",
        "{% if group['default'] is defined and group['default'] == 'true' %}default{% else %}not-default{% endif %}",
        "{% for cf in group['custom_formats'] -%}",
        "[{{ cf['name'] }}](#{{ cf_slug(cf['name']) }}) `{{ cf['trash_id'] }}`",
        "{% endfor %}",
        "{% endfor -%}",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    fs.rmSync(jroot, { recursive: true, force: true });
  });

  it("renders Python-semantics Jinja (macro, namespace, split, dictsort)", async () => {
    const files = await convertTrashGuides(jroot);
    const out = Object.fromEntries(files.map((f) => [f.path, f.content]))["Guide-Sync/sonarr-cf-groups.md"];

    // no unresolved Jinja tokens
    expect(out).not.toContain("{%");
    expect(out).not.toContain("{{");

    // category heading derived via .split(']')[0][1:]
    expect(out).toContain("## Audio");
    // group name via .split('] ')[1]
    expect(out).toContain("### Audio Formats");
    // macro cf_slug lowercases + replaces spaces
    expect(out).toContain("[TrueHD ATMOS](#truehd-atmos) `bbb222`");
    // `is defined and == 'true'` on a missing key -> else branch
    expect(out).toContain("not-default");
  });
});
