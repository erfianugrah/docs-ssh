import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverFromDokuWiki } from "../../../../src/ingestors/discovery/dokuwiki.js";

function mockWiki(pages: Record<string, string>) {
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      fetched.push(url);
      const body = pages[url];
      if (!body) return { ok: false, status: 404, text: async () => "", headers: new Headers() };
      return { ok: true, status: 200, text: async () => body, headers: new Headers() };
    }),
  );
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const INDEX = "https://wiki.example.com/start?do=index";
const PREFIX = "https://wiki.example.com/";

describe("discoverFromDokuWiki", () => {
  it("collects page links from the index page", async () => {
    mockWiki({
      [INDEX]: `
        <a href="/start?idx=docs">docs</a>
        <a href="/about">About</a>
        <a href="/start">Start</a>
      `,
      "https://wiki.example.com/start?idx=docs": `
        <a href="/docs/install">Install</a>
        <a href="/docs/config">Config</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://wiki.example.com/about",
        "https://wiki.example.com/start",
        "https://wiki.example.com/docs/install",
        "https://wiki.example.com/docs/config",
      ]),
    );
    expect(urls).toHaveLength(4);
  });

  it("recurses into nested namespaces (colon-form idx)", async () => {
    mockWiki({
      [INDEX]: `<a href="/start?idx=docs">docs</a>`,
      "https://wiki.example.com/start?idx=docs": `
        <a href="/start?idx=docs%3Aadvanced">advanced</a>
        <a href="/docs/install">Install</a>
      `,
      "https://wiki.example.com/start?idx=docs%3Aadvanced": `
        <a href="/docs/advanced/tuning">Tuning</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual([
      "https://wiki.example.com/docs/install",
      "https://wiki.example.com/docs/advanced/tuning",
    ]);
  });

  it("skips action URLs, external links, and non-doc extensions", async () => {
    mockWiki({
      [INDEX]: `
        <a href="/start?do=recent">recent</a>
        <a href="/feed.php?mode=list&amp;ns=">feed</a>
        <a href="https://other.example.com/page">external</a>
        <a href="/_media/logo.png">logo</a>
        <a href="/guide#section">fragment</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual(["https://wiki.example.com/guide"]);
  });

  it("decodes XHTML-escaped &amp; in idx hrefs", async () => {
    mockWiki({
      [INDEX]: `<a href="/start?id=sitemap&amp;idx=docs">docs</a>`,
      "https://wiki.example.com/start?id=sitemap&idx=docs": `
        <a href="/docs/install">Install</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual(["https://wiki.example.com/docs/install"]);
  });

  it("prunes excluded namespaces without fetching their idx pages", async () => {
    const fetched = mockWiki({
      [INDEX]: `
        <a href="/start?idx=docs">docs</a>
        <a href="/start?idx=de">deutsch</a>
      `,
      "https://wiki.example.com/start?idx=docs": `<a href="/docs/install">Install</a>`,
      "https://wiki.example.com/start?idx=de": `<a href="/de/anleitung">Anleitung</a>`,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX, "wiki\\.example\\.com/(de|fr)/");
    expect(urls).toEqual(["https://wiki.example.com/docs/install"]);
    expect(fetched).not.toContain("https://wiki.example.com/start?idx=de");
  });

  it("dedupes pages and idx links repeated in sidebars", async () => {
    mockWiki({
      [INDEX]: `
        <a href="/start?idx=docs">docs</a>
        <a href="/about">About</a>
      `,
      "https://wiki.example.com/start?idx=docs": `
        <a href="/start?idx=docs">self</a>
        <a href="/about">About again</a>
        <a href="/docs/install">Install</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual([
      "https://wiki.example.com/about",
      "https://wiki.example.com/docs/install",
    ]);
  });

  it("filters DokuWiki chrome paths on clean-URL wikis (domain-root prefix)", async () => {
    mockWiki({
      [INDEX]: `
        <a href="/lib/exe/css.php?t=bootstrap3">css</a>
        <a href="/_export/xhtml/start">export</a>
        <a href="/_media/wiki/logo.png">media</a>
        <a href="/feed.php">feed</a>
        <a href="/about">About</a>
      `,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual(["https://wiki.example.com/about"]);
  });

  it("tolerates fetch failures on idx pages", async () => {
    mockWiki({
      [INDEX]: `
        <a href="/start?idx=docs">docs</a>
        <a href="/start?idx=broken">broken</a>
        <a href="/about">About</a>
      `,
      "https://wiki.example.com/start?idx=docs": `<a href="/docs/install">Install</a>`,
    });
    const urls = await discoverFromDokuWiki(INDEX, PREFIX);
    expect(urls).toEqual([
      "https://wiki.example.com/about",
      "https://wiki.example.com/docs/install",
    ]);
  });
});
