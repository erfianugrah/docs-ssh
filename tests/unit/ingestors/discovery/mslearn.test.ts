import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverFromMsLearnToc } from "../../../../src/ingestors/discovery/mslearn.js";

function mockLearn(tocs: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      const body = tocs[url];
      if (!body) return { ok: false, status: 404, text: async () => "", headers: new Headers() };
      return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Headers() };
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const BASE = "https://learn.microsoft.com/en-us/azure/key-vault/";

describe("discoverFromMsLearnToc", () => {
  it("resolves nested relative hrefs across several toc.json files, scoped to baseUrl", async () => {
    mockLearn({
      [`${BASE}general/toc.json`]: {
        items: [
          { href: "./", toc_title: "Docs" },
          {
            toc_title: "Overview",
            children: [{ href: "overview" }, { href: "../keys/about-keys" }, { href: "#anchor-only" }],
          },
          { href: "../../architecture/guide/key-vault" },
          { href: "https://github.com/Azure/azure-sdk" },
          { href: "/en-us/cli/azure/keyvault" },
        ],
      },
      [`${BASE}keys/toc.json`]: { items: [{ href: "about-keys" }, { href: "quick-create-cli?tabs=bash#x" }] },
    });
    const urls = await discoverFromMsLearnToc(
      [`${BASE}general/toc.json`, `${BASE}keys/toc.json`].join(" "),
      BASE,
    );
    expect(urls.sort()).toEqual(
      [`${BASE}general/`, `${BASE}general/overview`, `${BASE}keys/about-keys`, `${BASE}keys/quick-create-cli`].sort(),
    );
  });

  it("throws when the first toc.json is unreachable", async () => {
    mockLearn({});
    await expect(discoverFromMsLearnToc(`${BASE}general/toc.json`, BASE)).rejects.toThrow("404");
  });
});
