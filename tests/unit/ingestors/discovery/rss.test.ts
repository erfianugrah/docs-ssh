import { describe, it, expect } from "vitest";
import { extractRssLinks } from "../../../../src/ingestors/discovery/rss.js";

describe("rss extractRssLinks", () => {
  it("returns absolute item links and ignores the channel link", () => {
    const xml = `<rss><channel><link>https://ex.org/</link>
      <item><link>https://ex.org/a/</link></item>
      <item><link><![CDATA[ https://ex.org/b ]]></link></item></channel></rss>`;
    expect(extractRssLinks(xml, "https://ex.org/feed.xml")).toEqual([
      "https://ex.org/a/",
      "https://ex.org/b",
    ]);
  });

  it("resolves relative item links against the feed URL (Hugo tag feeds, greatscottgadgets.com)", () => {
    const xml = `<rss><channel><link>/tags/cynthion/</link>
      <item><link>/2024/09-16-cynthion-is-here/</link></item>
      <item><link>2025/x/</link></item></channel></rss>`;
    expect(extractRssLinks(xml, "https://greatscottgadgets.com/tags/cynthion/index.xml")).toEqual([
      "https://greatscottgadgets.com/2024/09-16-cynthion-is-here/",
      "https://greatscottgadgets.com/tags/cynthion/2025/x/",
    ]);
  });

  it("drops links that are not http(s) after resolution", () => {
    const xml = `<item><link>mailto:a@b.c</link></item><item><link>javascript:x</link></item>`;
    expect(extractRssLinks(xml, "https://ex.org/feed.xml")).toEqual([]);
  });
});
