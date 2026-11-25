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

  // Keyboard controller rev 2 (2026-11-24): STM32H743ZI MCU + USB3320
  // ULPI PHY + external SPI ADCs + DRV5056 Hall sensors. Provenance only,
  // not mirrored; captures re-verified byte-identical to the private
  // vendor-binaries repo's st/FILES.tsv (gunzipped sha256, 2026-11-24).
  {
    vendor: "st",
    doc: "DS12110",
    title: "STM32H742xI/G, STM32H743xI/G 32-bit Arm Cortex-M7 480MHz MCUs, up to 2MB flash, up to 1MB RAM, 46 com. and analog interfaces",
    rev: "Rev 10",
    url: "https://www.st.com/resource/en/datasheet/stm32h743zi.pdf",
    fetch: "https://web.archive.org/web/20250530154524id_/https://www.st.com/resource/en/datasheet/stm32h743zi.pdf",
    vendorRepo: "st/stm32h743/ds12110-stm32h743zi.pdf",
  },
  {
    vendor: "st",
    doc: "ES0392",
    title: "STM32H742xI/G, STM32H743xI/G, STM32H750xB, STM32H753xI device errata",
    rev: "Rev 15",
    url: "https://www.st.com/resource/en/errata_sheet/es0392-stm32h742xig-stm32h743xig-and-stm32h753xi-device-errata-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20260526205148id_/https://www.st.com/resource/en/errata_sheet/es0392-stm32h742xig-stm32h743xig-and-stm32h753xi-device-errata-stmicroelectronics.pdf",
    vendorRepo: "st/stm32h743/es0392-stm32h742xig-and-stm32h743xig-device-errata-stmicroelectronics.pdf",
  },
  {
    vendor: "st",
    doc: "RM0433",
    title: "STM32H742, STM32H743/753 and STM32H750 Value line advanced Arm-based 32-bit MCUs",
    rev: "Rev 8",
    url: "https://www.st.com/resource/en/reference_manual/rm0433-stm32h742-stm32h743-753-and-stm32h750-value-line-advanced-armbased-32bit-mcus-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20260626122438id_/https://www.st.com/resource/en/reference_manual/rm0433-stm32h742-stm32h743-753-and-stm32h750-value-line-advanced-armbased-32bit-mcus-stmicroelectronics.pdf",
    vendorRepo:
      "st/stm32h743/rm0433-stm32h742-stm32h743-753-and-stm32h750-value-line-advanced-armbased-32bit-mcus-stmicroelectronics.pdf",
  },
  // Keyboard controller rev 2 follow-up (2026-11-25): boot-mode and USB-C
  // application notes plus the H7 SVD package (a zip, not a PDF; provenance
  // only). Captures are the newest of each st.com URL, gunzipped sha256
  // recorded in the private vendor-binaries repo's st/FILES.tsv.
  {
    vendor: "st",
    doc: "AN2606",
    title: "Introduction to system memory boot mode on STM32 MCUs",
    rev: "Rev 71",
    url: "https://www.st.com/resource/en/application_note/an2606-introduction-to-system-memory-boot-mode-on-stm32-mcus-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20261103193843id_/https://www.st.com/resource/en/application_note/an2606-introduction-to-system-memory-boot-mode-on-stm32-mcus-stmicroelectronics.pdf",
    vendorRepo: "st/stm32h743/an2606-introduction-to-system-memory-boot-mode-on-stm32-mcus-stmicroelectronics.pdf",
  },
  {
    vendor: "st",
    doc: "AN5225",
    title: "Introduction to USB Type-C Power Delivery for STM32 MCUs and MPUs",
    rev: "Rev 7",
    url: "https://www.st.com/resource/en/application_note/an5225-introduction-to-usb-type-c-power-delivery-for-stm32-mcus-and-mpus-stmicroelectronics.pdf",
    fetch:
      "https://web.archive.org/web/20261030110052id_/https://www.st.com/resource/en/application_note/an5225-introduction-to-usb-type-c-power-delivery-for-stm32-mcus-and-mpus-stmicroelectronics.pdf",
    vendorRepo:
      "st/stm32h743/an5225-introduction-to-usb-type-c-power-delivery-for-stm32-mcus-and-mpus-stmicroelectronics.pdf",
  },
  {
    vendor: "st",
    doc: "STM32H7_svd",
    title: "STM32H7 SVD package (STM32H743.svd and the other STM32H7 system view descriptions)",
    rev: "V2.8",
    url: "https://www.st.com/resource/en/svd/stm32h7-svd.zip",
    fetch: "https://web.archive.org/web/20261006213403id_/https://www.st.com/resource/en/svd/stm32h7-svd.zip",
    vendorRepo: "st/stm32h743/stm32h7-svd.zip",
  },

  // ── Microchip (USB3320/USB3320C ULPI PHY) ──────────────────────
  // www.microchip.com is not blocked, but only the aemDocuments path
  // serves the PDF: the content/dam/mchp and downloads/en/DeviceDoc
  // spellings serve a ~500-byte HTML page (checked 2026-11-24).
  {
    vendor: "microchip",
    doc: "DS00001792E",
    title: "USB3320 Highly Integrated Full Featured Hi-Speed USB 2.0 ULPI Transceiver",
    rev: "E",
    url: "https://ww1.microchip.com/downloads/en/DeviceDoc/00001792E.pdf",
    vendorRepo: "microchip/usb3320/usb3320-ds00001792e.pdf",
  },
  {
    vendor: "microchip",
    doc: "DS00005796A",
    title: "USB3320C Highly Integrated Full Featured Hi-Speed USB 2.0 ULPI Transceiver",
    rev: "A",
    url: "https://ww1.microchip.com/downloads/aemDocuments/documents/UNG/ProductDocuments/DataSheets/USB3320C-Data-Sheet-DS00005796.pdf",
    vendorRepo: "microchip/usb3320/usb3320c-ds00005796.pdf",
  },

  // ── Texas Instruments (ADS7953 ADCs, DRV5055/DRV5056 Hall sensors,
  //    REF50xx reference) ──────────────────────────────────────────
  // lit/ds/symlink serves ADS/DRV PDFs to a browser UA, but served HTML
  // error pages for ref5025 (2026-11-24), so REF50xx carries a pinned
  // capture; waybackOriginal needs the same scheme as `url`.
  {
    vendor: "ti",
    doc: "SLAS605",
    title: "ADS79xx Pin Compatible, 12-, 10-, 8-Bit, 1-MSPS, 16-, 12-, 8-, 4-Channel, Single-Ended, Serial Interface ADCs",
    rev: "C",
    url: "https://www.ti.com/lit/ds/symlink/ads7953.pdf",
    vendorRepo: "ti/ads7953.pdf",
  },
  {
    vendor: "ti",
    doc: "SBAS640",
    title: "DRV5055 Ratiometric Linear Hall Effect Sensor",
    rev: "C",
    url: "https://www.ti.com/lit/ds/symlink/drv5055.pdf",
    vendorRepo: "ti/drv5055.pdf",
  },
  {
    vendor: "ti",
    doc: "SBAS644",
    title: "DRV5056 Unipolar Ratiometric Linear Hall-Effect Sensor",
    rev: "C",
    url: "https://www.ti.com/lit/ds/symlink/drv5056.pdf",
    vendorRepo: "ti/drv5056.pdf",
  },
  {
    vendor: "ti",
    doc: "SBOS410",
    title: "REF50xx Low-Noise, Very Low Drift, Wide VIN Precision Voltage Reference",
    rev: "M",
    url: "https://www.ti.com/lit/ds/symlink/ref5025.pdf",
    fetch: "https://web.archive.org/web/20250211025050id_/https://www.ti.com/lit/ds/symlink/ref5025.pdf",
    vendorRepo: "ti/ref5025.pdf",
  },

  // ── 3PEAK (TPC512x SPI ADC) ─────────────────────────────────────
  {
    vendor: "3peak",
    doc: "BA20241107A1",
    title: "TPC512x 12-Bit 1-MHz SAR ADC",
    rev: "A1",
    url: "https://static.3peak.com/res/doc/ds/Datasheet_TPC512x.pdf",
    vendorRepo: "3peak/tpc512x-ds-ba20241107a1.pdf",
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
