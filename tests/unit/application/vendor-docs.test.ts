import { describe, expect, it } from "vitest";
import { SOURCES } from "../../../src/application/sources.js";
import { NO_LIVE_FETCH, UPSTREAM_ACCESS } from "../../../src/application/upstream-access.js";
import { VENDOR_DOCS, type VendorDoc, fetchUrl, vendorPdfFields } from "../../../src/application/vendor-docs.js";
import { waybackOriginal } from "../../../src/ingestors/HttpIngestor.js";

const host = (u: string) => new URL(u).host;
const PINNED = /^https:\/\/web\.archive\.org\/web\/\d{14}id_\//;

describe("vendor-docs manifest", () => {
  it("rows are well formed and unique by fetch URL", () => {
    const seen = new Set<string>();
    for (const d of VENDOR_DOCS) {
      const id = `${d.vendor}/${d.doc}`;
      expect(d.vendor, id).toMatch(/^[a-z0-9-]+$/);
      expect(d.title.trim(), id).not.toBe("");
      expect(d.url, id).toMatch(/^https:\/\//);
      if (d.vendorRepo) expect(d.vendorRepo.startsWith(`${d.vendor}/`), `${id}: vendorRepo outside its vendor dir`).toBe(true);
      expect(seen.has(fetchUrl(d)), `${id}: duplicate ${fetchUrl(d)}`).toBe(false);
      seen.add(fetchUrl(d));
    }
  });

  it("documents on blocked hosts are fetched from a pinned capture of exactly url, or a mirror", () => {
    for (const d of VENDOR_DOCS) {
      const entry = UPSTREAM_ACCESS[host(d.url)];
      const id = `${d.vendor}/${d.doc}`;
      if (d.fetch?.startsWith("https://web.archive.org/")) {
        expect(d.fetch, `${id}: capture not pinned`).toMatch(PINNED);
        expect(waybackOriginal(d.fetch), `${id}: capture of another URL`).toBe(d.url);
      }
      if (entry && NO_LIVE_FETCH.has(entry.status)) {
        expect(d.fetch, `${id}: ${host(d.url)} is ${entry.status}, set fetch`).toBeDefined();
        expect(host(d.fetch!), `${id}: fetch on the blocked host`).not.toBe(host(d.url));
      }
    }
  });

  it("every row's source is a pdf source built from this manifest", () => {
    const byName = new Map(SOURCES.map((s) => [s.name, s]));
    for (const name of new Set(VENDOR_DOCS.map((d) => d.source).filter((s): s is string => !!s))) {
      const s = byName.get(name);
      expect(s, `${name}: no such source`).toBeDefined();
      expect(s!.discovery, name).toBe("pdf");
      const want = vendorPdfFields(name);
      expect(s!.discoveryUrl, `${name}: discoveryUrl not from vendorPdfFields()`).toBe(want.discoveryUrl);
      expect(s!.pdfTitles, name).toEqual(want.pdfTitles);
    }
  });

  it("vendorPdfFields: fetch URL wins, titles carry doc number and revision, unknown source throws", () => {
    const docs: VendorDoc[] = [
      { vendor: "st", doc: "AN4879", title: "USB hardware and PCB guidelines", rev: "Rev 13", url: "https://www.st.com/a.pdf", fetch: "https://web.archive.org/web/20260101000000id_/https://www.st.com/a.pdf", source: "s" },
      { vendor: "usb-if", doc: "HUT 1.5", title: "HID Usage Tables 1.5 (HUT 1.5)", url: "https://u/h.pdf", source: "s" },
      { vendor: "x", doc: "D", title: "Other", url: "https://x/d.pdf", source: "t" },
    ];
    const f = vendorPdfFields("s", docs);
    expect(f.discoveryUrl).toBe("https://web.archive.org/web/20260101000000id_/https://www.st.com/a.pdf https://u/h.pdf");
    expect(f.pdfTitles).toEqual({
      "https://web.archive.org/web/20260101000000id_/https://www.st.com/a.pdf": "USB hardware and PCB guidelines (AN4879, Rev 13)",
      "https://u/h.pdf": "HID Usage Tables 1.5 (HUT 1.5)",
    });
    expect(() => vendorPdfFields("nope", docs)).toThrow(/no rows/);
  });
});
