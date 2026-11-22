/**
 * Vendor document manifest: one row per vendor PDF (datasheet, reference
 * manual, errata, app note, spec) that we hold anywhere - mirrored as text on
 * docs.erfi.io, kept as a binary in the owner's private vendor-binaries repo,
 * or both.
 *
 * Before this (2026-11-22) the same documents were found twice: the binaries
 * repo fetched ST PDFs through Wayback captures and recorded no capture URL,
 * and it held newer Artery revisions than docs.erfi.io mirrored. Now the URL
 * research lands here once:
 *
 * - `pdf` sources take their URL list and per-document titles from this file
 *   (`...vendorPdfFields("<source>")` in sources.ts), so the manifest cannot
 *   drift from what the build fetches;
 * - the binaries repo keeps the files and their sha256/pages and points here
 *   for where each document came from (its `vendorRepo` path).
 *
 * Rules (tests/unit/application/vendor-docs.test.ts): `url` is the vendor's
 * own URL and what docs cite; when its host is blocked or challenged in
 * UPSTREAM_ACCESS (upstream-access.ts), `fetch` must hold a pinned Wayback raw
 * capture of exactly `url` (`https://web.archive.org/web/<14 digits>id_/<url>`)
 * or a mirror on another host. A row with `source` must belong to a `pdf`
 * source whose discoveryUrl is generated from this file.
 *
 * Copyright: vendor PDFs are mirrored as text only where the vendor publishes
 * them for free download (at32f405, wch-ch32v30x and usb-hid-usage-tables set
 * the precedent); rows without `source` are not mirrored, and the binaries
 * repo itself must never be made public.
 */

export interface VendorDoc {
  /** Short vendor key: st, artery, wch, usb-if, nordic, nuvoton, rpi, ... */
  readonly vendor: string;
  /** Vendor document number (DS14359, RM0477, AN4879, UM2502), else the filename stem. */
  readonly doc: string;
  /** Document title as the vendor gives it; the H1 of every section page. */
  readonly title: string;
  /** Revision as printed on the document (Rev 4, V2.03). */
  readonly rev?: string;
  /** Where the vendor publishes it; what docs cite. */
  readonly url: string;
  /** What the build downloads when `url`'s host is blocked: a pinned capture of `url` or a mirror. */
  readonly fetch?: string;
  /** docs-ssh source that mirrors it as text. */
  readonly source?: string;
  /** Path of the binary in the private vendor-binaries repo (vendor dir included). */
  readonly vendorRepo?: string;
}

export const VENDOR_DOCS: readonly VendorDoc[] = [
  // ── Artery ─────────────────────────────────────────────────────
  {
    vendor: "artery",
    doc: "DS_AT32F405_402",
    title: "AT32F402/405 Datasheet",
    rev: "V2.03",
    url: "https://www.arterychip.com/download/DS/DS_AT32F405_402_V2.03_EN.pdf",
    source: "at32f405",
    vendorRepo: "artery/at32f405/DS_AT32F405_402_V2.03_EN.pdf",
  },
  {
    vendor: "artery",
    doc: "RM_AT32F402_405",
    title: "AT32F402/405 Reference Manual",
    rev: "V2.02",
    url: "https://www.arterychip.com/download/RM/RM_AT32F402_405_EN_V2.02.pdf",
    source: "at32f405",
    vendorRepo: "artery/at32f405/RM_AT32F402_405_EN_V2.02.pdf",
  },
  {
    vendor: "artery",
    doc: "AN0185",
    title: "AT32 MCU OTGHS Application Note",
    rev: "V2.0.0",
    url: "https://www.arterytek.com/download/APNOTE/AN0185_AT32_MCU_OTGHS_Application_Note_EN_V2.0.0.pdf",
    source: "at32f405",
    vendorRepo: "artery/at32f405/AN0185_OTGHS_EN.pdf",
  },
  {
    vendor: "artery",
    doc: "AN0185-ZH",
    title: "AT32 MCU OTGHS Application Note (Chinese)",
    rev: "V2.0.0",
    url: "https://www.arterytek.com/download/APNOTE/AN0185_AT32_MCU_OTGHS_Application_Note_ZH_V2.0.0.pdf",
    source: "at32f405",
    vendorRepo: "artery/at32f405/AN0185_OTGHS_CN_V2.0.0.pdf",
  },

  // ── WCH (wch.cn product pages are JS SPAs with no direct PDF URLs) ──
  {
    vendor: "wch",
    doc: "CH32FV2x_V3xRM",
    title: "CH32FV2x/V3x Reference Manual",
    url: "https://raw.githubusercontent.com/wuxx/nanoCH32V203/master/doc/CH32FV2x_V3xRM_en.PDF",
    source: "wch-ch32v30x",
  },
  {
    vendor: "wch",
    doc: "CH32V307DS0",
    title: "CH32V30x Datasheet",
    url: "https://arvidtek.com/wp-content/uploads/2025/01/CH32V307DS0.pdf",
    source: "wch-ch32v30x",
  },

  // ── STMicroelectronics ─────────────────────────────────────────
  // Provenance only, not mirrored: ST's site terms (capture 20261020105546 of
  // /content/st_com/en/about/terms-of-use.html) forbid reproducing or
  // distributing its Materials without written permission. www.st.com and
  // www.st.com.cn are blocked for us, so every row needs a pinned capture;
  // ST's CDN gzip-encodes PDFs and Wayback replays that (undici decodes it).
  // Check a capture with pdfinfo before pinning it: the 2024-09-10 UM2502
  // capture is cut at 1 MiB.
  {
    vendor: "st",
    doc: "DS4260",
    title: "USBLC6-2 Very low capacitance ESD protection",
    rev: "Rev 7",
    url: "https://www.st.com/resource/en/datasheet/usblc6-2.pdf",
    fetch: "https://web.archive.org/web/20261117191058id_/https://www.st.com/resource/en/datasheet/usblc6-2.pdf",
  },
  {
    vendor: "st",
    doc: "AN4879",
    title: "Introduction to USB hardware and PCB guidelines using STM32 MCUs",
    rev: "Rev 12",
    url: "https://www.st.com/resource/en/application_note/an4879-introduction-to-usb-hardware-and-pcb-guidelines-using-stm32-mcus-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20261001185309id_/https://www.st.com/resource/en/application_note/an4879-introduction-to-usb-hardware-and-pcb-guidelines-using-stm32-mcus-stmicroelectronics.pdf",
  },
  {
    vendor: "st",
    doc: "UM2502",
    title: "STLINK-V3MODS and STLINK-V3MINI debugger/programmer tiny probes for STM32 microcontrollers",
    rev: "Rev 2",
    url: "https://www.st.com/resource/en/user_manual/um2502-stlinkv3mods-and-stlinkv3mini-debuggerprogrammer-tiny-probes-for-stm32-microcontrollers-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20231216150458id_/https://www.st.com/resource/en/user_manual/um2502-stlinkv3mods-and-stlinkv3mini-debuggerprogrammer-tiny-probes-for-stm32-microcontrollers-stmicroelectronics.pdf",
  },

  // ── USB-IF ─────────────────────────────────────────────────────
  {
    vendor: "usb-if",
    doc: "HUT 1.5",
    title: "HID Usage Tables 1.5",
    url: "https://www.usb.org/sites/default/files/hut1_5.pdf",
    source: "usb-hid-usage-tables",
  },
  {
    vendor: "usb-if",
    doc: "HID 1.11",
    title: "Device Class Definition for HID 1.11",
    url: "https://www.usb.org/sites/default/files/hid1_11.pdf",
    source: "usb-hid-usage-tables",
  },
];

/** The URL the build downloads for a row. */
export function fetchUrl(doc: VendorDoc): string {
  return doc.fetch ?? doc.url;
}

/**
 * `discoveryUrl` + `pdfTitles` for a `pdf` source, from its manifest rows in
 * file order. Throws on an unknown source name so a typo fails at import.
 */
export function vendorPdfFields(
  source: string,
  docs: readonly VendorDoc[] = VENDOR_DOCS,
): { discoveryUrl: string; pdfTitles: Record<string, string> } {
  const rows = docs.filter((d) => d.source === source);
  if (rows.length === 0) throw new Error(`vendor-docs: no rows for source ${source}`);
  const pdfTitles: Record<string, string> = {};
  for (const d of rows) {
    const tags = [d.title.includes(d.doc) ? "" : d.doc, d.rev ?? ""].filter(Boolean);
    pdfTitles[fetchUrl(d)] = tags.length > 0 ? `${d.title} (${tags.join(", ")})` : d.title;
  }
  return { discoveryUrl: rows.map(fetchUrl).join(" "), pdfTitles };
}
