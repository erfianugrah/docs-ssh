import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  LINKS_FILENAME,
  buildLinkGraph,
  extractLinks,
  normaliseUrl,
  writeLinksTsv,
} from "../../../src/application/link-graph.js";

describe("extractLinks", () => {
  it("returns inline link targets in order, titles and angle brackets stripped", () => {
    const md = [
      "See [SELECT](sql-select.html) and [docs](/docs/guides/cors \"CORS guide\").",
      "Also [spaced](<my page.md>) and [abs](https://example.com/a#frag).",
    ].join("\n");
    expect(extractLinks(md)).toEqual([
      "sql-select.html",
      "/docs/guides/cors",
      "my page.md",
      "https://example.com/a#frag",
    ]);
  });

  it("skips images and anything inside fenced code blocks", () => {
    const md = [
      "![diagram](diagram.svg)",
      "[real](real.md)",
      "```md",
      "[fake](fake.md)",
      "```",
      "~~~",
      "[fake2](fake2.md)",
      "~~~",
      "[after](after.md)",
    ].join("\n");
    expect(extractLinks(md)).toEqual(["real.md", "after.md"]);
  });
});

describe("normaliseUrl", () => {
  it("canonicalises scheme, fragment, query, index pages, extensions and trailing slash", () => {
    expect(normaliseUrl("http://Example.com/docs/a/")).toBe("https://example.com/docs/a");
    expect(normaliseUrl("https://example.com/docs/a.html#x")).toBe("https://example.com/docs/a");
    expect(normaliseUrl("https://example.com/docs/a/index.html?y=1")).toBe("https://example.com/docs/a");
    expect(normaliseUrl("https://example.com/docs/a.md")).toBe("https://example.com/docs/a");
    expect(normaliseUrl("https://github.com/o/r/blob/HEAD/docs/a.mdx")).toBe(
      "https://github.com/o/r/blob/HEAD/docs/a",
    );
    expect(normaliseUrl("https://example.com/docs/a/index.md")).toBe("https://example.com/docs/a");
  });

  it("rejects non-http URLs and garbage", () => {
    expect(normaliseUrl("mailto:a@b.c")).toBeUndefined();
    expect(normaliseUrl("not a url")).toBeUndefined();
  });

  it("lowercases learn.microsoft.com paths", () => {
    expect(normaliseUrl("https://learn.microsoft.com/EN-US/Windows/Win32/API/Winreg/Nf-Winreg-RegOpenKeyExW"))
      .toBe("https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw");
  });

  it("inserts /en-us/ on learn.microsoft.com windows/ paths missing the locale prefix", () => {
    expect(normaliseUrl("https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regopenkeyexw"))
      .toBe("https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw");
    expect(normaliseUrl("https://learn.microsoft.com/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getfeature"))
      .toBe("https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_getfeature");
  });

  it("leaves non-windows paths alone on learn.microsoft.com (no en-us insertion)", () => {
    expect(normaliseUrl("https://learn.microsoft.com/azure/something"))
      .toBe("https://learn.microsoft.com/azure/something");
  });

  it("aliases /windows/desktop/api/ to /windows/win32/api/", () => {
    expect(normaliseUrl("https://learn.microsoft.com/en-us/windows/desktop/api/winreg/nf-winreg-regopenkeyexw"))
      .toBe("https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw");
  });

  it("aliases /windows/desktop/api/ and inserts en-us together", () => {
    expect(normaliseUrl("https://learn.microsoft.com/windows/desktop/api/winreg/nf-winreg-regopenkeyexw"))
      .toBe("https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw");
  });
});

const PG = "https://www.postgresql.org/docs/current/";

describe("buildLinkGraph", () => {
  it("resolves relative links against the page origin and maps them through _origins (http source)", () => {
    const origins = new Map([
      ["postgres/sql-select.md", `${PG}sql-select.html`],
      ["postgres/sql-insert.md", `${PG}sql-insert.html`],
    ]);
    const edges = buildLinkGraph(
      [
        { path: "postgres/sql-select.md", links: ["sql-insert.html", "#anchor", "sql-select.html", "mailto:x@y.z"] },
        { path: "postgres/sql-insert.md", links: [] },
      ],
      origins,
    );
    expect(edges).toEqual([["postgres/sql-select.md", "postgres/sql-insert.md"]]);
  });

  it("finds cross-source edges through absolute URLs", () => {
    const origins = new Map([
      ["supabase/guides/db.md", "https://github.com/supabase/supabase/blob/HEAD/apps/docs/content/guides/db.mdx"],
      ["postgres/sql-select.md", `${PG}sql-select.html`],
    ]);
    const edges = buildLinkGraph(
      [{ path: "supabase/guides/db.md", links: [`${PG}sql-select.html#id-1`] }],
      origins,
    );
    expect(edges).toEqual([["supabase/guides/db.md", "postgres/sql-select.md"]]);
  });

  it("ignores an origin URL shared by 3+ files (bulk fallback) and picks the smallest path for 2", () => {
    const origins = new Map([
      ["api/a.md", "https://api.example.com/"],
      ["api/b.md", "https://api.example.com/"],
      ["api/c.md", "https://api.example.com/"],
      ["dup/z.md", "https://dup.example.com/page/"],
      ["dup/y.md", "https://dup.example.com/page/"],
      ["src/p.md", "https://src.example.com/p"],
    ]);
    const edges = buildLinkGraph(
      [{ path: "src/p.md", links: ["https://api.example.com/", "https://dup.example.com/page"] }],
      origins,
    );
    expect(edges).toEqual([["src/p.md", "dup/y.md"]]);
  });

  it("matches site-relative links by path suffix within the same source (git source with blob origins)", () => {
    const pages = [
      { path: "kubernetes/tutorials/hello.md", links: ["/docs/concepts/workloads/pods/", "/docs/tasks/tools/#kubectl"] },
      { path: "kubernetes/concepts/workloads/pods/_index.md", links: [] },
      { path: "kubernetes/tasks/tools/index.md", links: [] },
    ];
    const edges = buildLinkGraph(pages, new Map());
    expect(edges).toEqual([
      ["kubernetes/tutorials/hello.md", "kubernetes/concepts/workloads/pods/_index.md"],
      ["kubernetes/tutorials/hello.md", "kubernetes/tasks/tools/index.md"],
    ]);
  });

  it("matches page-relative links against the page's directory and never escapes the source", () => {
    const pages = [
      { path: "caddy/docs/caddyfile/directives.md", links: ["../json/index.md", "./matchers.md", "../../../other/x.md"] },
      { path: "caddy/docs/json/index.md", links: [] },
      { path: "caddy/docs/caddyfile/matchers.md", links: [] },
      { path: "other/x.md", links: [] },
    ];
    const edges = buildLinkGraph(pages, new Map());
    expect(edges).toEqual([
      ["caddy/docs/caddyfile/directives.md", "caddy/docs/caddyfile/matchers.md"],
      ["caddy/docs/caddyfile/directives.md", "caddy/docs/json/index.md"],
    ]);
  });

  it("suffix matching drops leading segments only while 2+ segments remain", () => {
    const pages = [
      { path: "s/guide/a.md", links: ["/about/news/install", "/docs/x/install"] },
      { path: "s/install.md", links: [] },
      { path: "s/x/install.md", links: [] },
    ];
    // "/about/news/install" would need a 1-segment suffix ("install"): no match.
    // "/docs/x/install" matches "x/install" (2 segments).
    expect(buildLinkGraph(pages, new Map())).toEqual([["s/guide/a.md", "s/x/install.md"]]);
  });

  it("drops self links and duplicate edges, output sorted by (from, to)", () => {
    const pages = [
      { path: "s/b.md", links: ["/x/a", "/x/a", "/b"] },
      { path: "s/x/a.md", links: ["/b"] },
    ];
    expect(buildLinkGraph(pages, new Map())).toEqual([
      ["s/b.md", "s/x/a.md"],
      ["s/x/a.md", "s/b.md"],
    ]);
  });

  it("drops navigation hubs: a target linked from more than half of a 20+ file source", () => {
    const pages: { path: string; links: string[] }[] = [{ path: "big/hub/home.md", links: [] }];
    for (let i = 0; i < 24; i++) {
      // 13 of 25 files link the hub (> half); file 0 also links page 1.
      pages.push({ path: `big/p/${i}.md`, links: i < 13 ? ["/hub/home", ...(i === 0 ? ["/p/1"] : [])] : [] });
    }
    const edges = buildLinkGraph(pages, new Map());
    expect(edges).toEqual([["big/p/0.md", "big/p/1.md"]]);
  });

  it("keeps a popular target in a small source (< 20 files)", () => {
    const pages = [
      { path: "small/a/x.md", links: ["/b/hub"] },
      { path: "small/a/y.md", links: ["/b/hub"] },
      { path: "small/b/hub.md", links: [] },
    ];
    expect(buildLinkGraph(pages, new Map())).toHaveLength(2);
  });

  it("resolves learn.microsoft.com cross-source links through origin reverse map", () => {
    // win32-api page links to a win32-docs page via site-relative path.
    // The link page's origin resolves the relative URL against learn.microsoft.com
    // and the target's origin maps it back through the reverse index.
    const origins = new Map([
      ["win32-api/winreg/nf-winreg-regopenkeyexw.md",
        "https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regopenkeyexw"],
      ["win32-docs/coreaudio/wasapi.md",
        "https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi"],
    ]);
    const edges = buildLinkGraph(
      [
        {
          path: "win32-api/winreg/nf-winreg-regopenkeyexw.md",
          links: ["/windows/win32/CoreAudio/wasapi"],
        },
        { path: "win32-docs/coreaudio/wasapi.md", links: [] },
      ],
      origins,
    );
    expect(edges).toEqual([
      ["win32-api/winreg/nf-winreg-regopenkeyexw.md", "win32-docs/coreaudio/wasapi.md"],
    ]);
  });

  it("resolves /windows/desktop/api/ links via the desktop->win32 alias", () => {
    const origins = new Map([
      ["win32-docs/coreaudio/wasapi.md",
        "https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi"],
      ["win32-api/cfgmgr32/nf-cfgmgr32-cm_get_device_interface_lista.md",
        "https://learn.microsoft.com/en-us/windows/win32/api/cfgmgr32/nf-cfgmgr32-cm_get_device_interface_lista"],
    ]);
    const edges = buildLinkGraph(
      [
        {
          path: "win32-docs/coreaudio/wasapi.md",
          links: ["/windows/desktop/api/cfgmgr32/nf-cfgmgr32-cm_get_device_interface_lista"],
        },
        { path: "win32-api/cfgmgr32/nf-cfgmgr32-cm_get_device_interface_lista.md", links: [] },
      ],
      origins,
    );
    expect(edges).toEqual([
      ["win32-docs/coreaudio/wasapi.md", "win32-api/cfgmgr32/nf-cfgmgr32-cm_get_device_interface_lista.md"],
    ]);
  });
});

describe("writeLinksTsv", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "links-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("walks every source dir, joins _origins.tsv and writes sorted from<TAB>to lines", async () => {
    await fs.mkdir(path.join(dir, "postgres"), { recursive: true });
    await fs.mkdir(path.join(dir, "kubernetes/concepts"), { recursive: true });
    await fs.writeFile(path.join(dir, "postgres/sql-select.md"), "# SELECT\n\nSee [INSERT](sql-insert.html).\n");
    await fs.writeFile(path.join(dir, "postgres/sql-insert.md"), "# INSERT\n");
    await fs.writeFile(path.join(dir, "kubernetes/concepts/pods.md"), "[nodes](/docs/concepts/nodes/)\n");
    await fs.writeFile(path.join(dir, "kubernetes/concepts/nodes.md"), "# Nodes\n");
    await fs.writeFile(path.join(dir, "kubernetes/.stamp.json"), "{}");
    await fs.writeFile(path.join(dir, "_index.tsv"), "ignored\n");
    await fs.writeFile(
      path.join(dir, "_origins.tsv"),
      `postgres/sql-select.md\t${PG}sql-select.html\npostgres/sql-insert.md\t${PG}sql-insert.html\n`,
    );

    const n = await writeLinksTsv(dir);
    expect(n).toBe(2);
    expect(LINKS_FILENAME).toBe("_links.tsv");
    const body = await fs.readFile(path.join(dir, LINKS_FILENAME), "utf-8");
    expect(body).toBe(
      "kubernetes/concepts/pods.md\tkubernetes/concepts/nodes.md\npostgres/sql-select.md\tpostgres/sql-insert.md\n",
    );
  });

  it("works without _origins.tsv and writes an empty file when there are no edges", async () => {
    await fs.mkdir(path.join(dir, "s"), { recursive: true });
    await fs.writeFile(path.join(dir, "s/a.md"), "no links\n");
    expect(await writeLinksTsv(dir)).toBe(0);
    expect(await fs.readFile(path.join(dir, LINKS_FILENAME), "utf-8")).toBe("");
  });
});
