import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverFromMediaWiki, mediaWikiTitlePath } from "../../../../src/ingestors/discovery/mediawiki.js";

afterEach(() => vi.unstubAllGlobals());

describe("mediaWikiTitlePath", () => {
  // MediaWiki serves subpages and namespaces at literal / and :; the
  // encoded %2F / %3A forms 404 (samba lost 452 of 579 pages to this).
  it("keeps / and : literal, underscores spaces, encodes the rest", () => {
    expect(mediaWikiTitlePath("Samba4/User Testing")).toBe("Samba4/User_Testing");
    expect(mediaWikiTitlePath("Portal:DeveloperDocs/Contributing")).toBe("Portal:DeveloperDocs/Contributing");
    expect(mediaWikiTitlePath("C++ & you?")).toBe("C%2B%2B_%26_you%3F");
    expect(mediaWikiTitlePath("Café")).toBe("Caf%C3%A9");
  });
});

describe("discoverFromMediaWiki", () => {
  it("builds page URLs from allpages titles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ query: { allpages: [{ title: "Samba4/UserTesting" }, { title: "Main Page" }] } }),
      }),
    );
    expect(await discoverFromMediaWiki("https://wiki.samba.org/api.php", "https://wiki.samba.org/index.php/")).toEqual([
      "https://wiki.samba.org/index.php/Samba4/UserTesting",
      "https://wiki.samba.org/index.php/Main_Page",
    ]);
  });
});
