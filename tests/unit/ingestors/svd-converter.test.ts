import { describe, it, expect } from "vitest";
import {
  convertSvdToMarkdown,
  asArray,
  parseNumber,
  parseDimIndex,
  parseBitRange,
  formatBits,
  type ConvertedFile,
} from "../../../src/ingestors/svd-converter.js";

const FIXTURE = `<?xml version="1.0"?>
<device schemaVersion="1.3">
  <name>TESTMCU</name>
  <description>Test MCU for the SVD converter</description>
  <addressUnitBits>8</addressUnitBits>
  <width>32</width>
  <size>32</size>
  <access>read-write</access>
  <resetValue>0x00000000</resetValue>
  <peripherals>
    <peripheral>
      <name>USBD</name>
      <description>Universal serial bus device</description>
      <baseAddress>0x40027000</baseAddress>
      <interrupt>
        <name>USBD</name>
        <description>USB device interrupt</description>
        <value>39</value>
      </interrupt>
      <registers>
        <register>
          <dim>8</dim>
          <dimIncrement>0x4</dimIncrement>
          <name>TASKS_STARTEPIN[%s]</name>
          <description>Captures EPIN[n]</description>
          <addressOffset>0x004</addressOffset>
          <access>write-only</access>
          <resetValue>0x00000000</resetValue>
          <fields>
            <field>
              <name>TASKS_STARTEPIN</name>
              <description>Trigger endpoint task</description>
              <lsb>0</lsb>
              <msb>0</msb>
              <enumeratedValues>
                <enumeratedValue>
                  <name>Trigger</name>
                  <description>Trigger task</description>
                  <value>0x1</value>
                </enumeratedValue>
              </enumeratedValues>
            </field>
          </fields>
        </register>
        <register>
          <name>INTENSET</name>
          <description>Enable interrupt</description>
          <addressOffset>0x304</addressOffset>
          <fields>
            <field>
              <name>END</name>
              <description>END event enable</description>
              <bitOffset>3</bitOffset>
              <bitWidth>1</bitWidth>
            </field>
            <field>
              <name>RANGE</name>
              <description>Range field via bitRange</description>
              <bitRange>[15:8]</bitRange>
            </field>
          </fields>
        </register>
        <cluster>
          <name>INFO</name>
          <description>Device info</description>
          <addressOffset>0x100</addressOffset>
          <register>
            <name>PART</name>
            <description>Part code</description>
            <addressOffset>0x000</addressOffset>
            <access>read-only</access>
            <resetValue>0x12345678</resetValue>
            <fields>
              <field>
                <name>PART</name>
                <description>Part code</description>
                <lsb>0</lsb>
                <msb>31</msb>
              </field>
            </fields>
          </register>
        </cluster>
      </registers>
    </peripheral>
    <peripheral>
      <name>USBD_BASE</name>
      <description>Shared USBD register block</description>
      <baseAddress>0x40027000</baseAddress>
      <access>read-only</access>
      <resetValue>0xFFFFFFFF</resetValue>
      <registers>
        <register>
          <name>SHARED_REG</name>
          <description>Shared register</description>
          <addressOffset>0x000</addressOffset>
        </register>
      </registers>
    </peripheral>
    <peripheral derivedFrom="USBD_BASE">
      <name>USBD2</name>
      <description>Second USB device</description>
      <baseAddress>0x40028000</baseAddress>
      <interrupt>
        <name>USBD2</name>
        <value>40</value>
      </interrupt>
    </peripheral>
  </peripherals>
</device>
`;

function convert(): ConvertedFile[] {
  return convertSvdToMarkdown(FIXTURE, "testmcu");
}

function get(path: string): string {
  const f = convert().find((c) => c.path === path);
  expect(f, `missing output file ${path}`).toBeDefined();
  return f!.content;
}

describe("convertSvdToMarkdown", () => {
  it("emits an index plus one page per peripheral", () => {
    const files = convert();
    expect(files.map((f) => f.path).sort()).toEqual(
      [
        "testmcu/index.md",
        "testmcu/USBD.md",
        "testmcu/USBD_BASE.md",
        "testmcu/USBD2.md",
      ].sort(),
    );
  });

  it("uses the device name (not the filename fallback) for the dir", () => {
    const files = convertSvdToMarkdown(`<device><name>AT32F405xx_v2</name><peripherals/></device>`, "fallback");
    expect(files.some((f) => f.path.startsWith("at32f405xx_v2/"))).toBe(true);
  });

  it("falls back to the filename base when <name> is absent", () => {
    const files = convertSvdToMarkdown(`<device><peripherals/></device>`, "nrf52840");
    expect(files.some((f) => f.path.startsWith("nrf52840/"))).toBe(true);
  });
});

describe("peripheral page", () => {
  it("renders H1, base address and interrupt", () => {
    const md = get("testmcu/USBD.md");
    expect(md).toContain("# TESTMCU USBD - Universal serial bus device");
    expect(md).toContain("Base address: `0x40027000`");
    expect(md).toContain("Interrupt: `USBD` (39)");
  });

  it("expands dim arrays into per-element summary rows with exact offsets", () => {
    const md = get("testmcu/USBD.md");
    expect(md).toContain("| TASKS_STARTEPIN[0] | 0x4 | 0x40027004 | write-only | 0x00000000 | Captures EPIN[n] |");
    expect(md).toContain("| TASKS_STARTEPIN[7] | 0x20 | 0x40027020 | write-only | 0x00000000 | Captures EPIN[n] |");
    expect(md).toContain("## TASKS_STARTEPIN[%s]");
    expect(md).toContain("Offset: `0x4` (array of 8, stride `0x4`)");
  });

  it("resolves field bit ranges via lsb/msb, bitOffset/bitWidth and bitRange", () => {
    const md = get("testmcu/USBD.md");
    // lsb/msb single bit
    expect(md).toContain("| 0 | TASKS_STARTEPIN | write-only | Trigger endpoint task. Values: `0x1 Trigger` |");
    // bitOffset=3 bitWidth=1
    expect(md).toContain("| 3 | END | read-write | END event enable |");
    // bitRange [15:8]
    expect(md).toContain("| [15:8] | RANGE | read-write | Range field via bitRange |");
    // lsb=0 msb=31
    expect(md).toContain("| [31:0] | PART | read-only | Part code |");
  });

  it("renders enumerated values inline", () => {
    const md = get("testmcu/USBD.md");
    expect(md).toContain("Values: `0x1 Trigger`");
  });

  it("inherits access/resetValue from device defaults for registers that omit them", () => {
    const md = get("testmcu/USBD.md");
    // INTENSET has no access/resetValue → device defaults (read-write / 0x00000000)
    expect(md).toContain("| INTENSET | 0x304 | 0x40027304 | read-write | 0x00000000 | Enable interrupt |");
  });

  it("flattens clusters with their address offset folded in", () => {
    const md = get("testmcu/USBD.md");
    // PART is inside INFO (offset 0x100): absolute 0x40027000 + 0x100 + 0x000
    expect(md).toContain("| PART | 0x100 | 0x40027100 | read-only | 0x12345678 | Part code |");
    expect(md).toContain("## PART");
    expect(md).toContain("Cluster: `INFO`");
  });
});

describe("peripheral-level access/reset defaults", () => {
  it("propagate to registers that omit them", () => {
    const md = get("testmcu/USBD_BASE.md");
    // SHARED_REG omits access/reset → USBD_BASE defaults (read-only / 0xFFFFFFFF)
    expect(md).toContain("| SHARED_REG | 0x0 | 0x40027000 | read-only | 0xFFFFFFFF | Shared register |");
  });
});

describe("derivedFrom", () => {
  it("inherits registers from the base peripheral, overriding base address and interrupt", () => {
    const md = get("testmcu/USBD2.md");
    expect(md).toContain("# TESTMCU USBD2 - Second USB device");
    expect(md).toContain("Base address: `0x40028000`");
    expect(md).toContain("Derived from: `USBD_BASE`");
    expect(md).toContain("Interrupt: `USBD2` (40)");
    // inherits SHARED_REG from USBD_BASE (with base's read-only/0xFFFFFFFF defaults)
    expect(md).toContain("| SHARED_REG | 0x0 | 0x40028000 | read-only | 0xFFFFFFFF | Shared register |");
    // must not leak the base peripheral's interrupt
    expect(md).not.toContain("(39)");
  });
});

describe("index.md", () => {
  it("lists peripherals with base addresses and interrupt vector table", () => {
    const md = get("testmcu/index.md");
    expect(md).toContain("# TESTMCU - Test MCU for the SVD converter");
    expect(md).toContain("| USBD | 0x40027000 | USBD (39) | Universal serial bus device |");
    expect(md).toContain("## Interrupt vector table");
    expect(md).toContain("| 39 | USBD | USBD |");
    expect(md).toContain("| 40 | USBD2 | USBD2 |");
  });
});

describe("helper functions", () => {
  it("parseNumber handles hex and decimal", () => {
    expect(parseNumber("0x4")).toBe(4);
    expect(parseNumber("0x40027000")).toBe(0x40027000);
    expect(parseNumber("39")).toBe(39);
    expect(parseNumber("0x8")).toBe(8);
    expect(parseNumber(undefined)).toBeNaN();
  });

  it("parseDimIndex expands ranges and lists", () => {
    expect(parseDimIndex("0-7")).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    expect(parseDimIndex("0,1,2")).toEqual(["0", "1", "2"]);
    expect(parseDimIndex("0-3,5")).toEqual(["0", "1", "2", "3", "5"]);
    expect(parseDimIndex("A,B")).toEqual(["A", "B"]);
    expect(parseDimIndex(undefined)).toEqual([]);
  });

  it("parseBitRange parses [msb:lsb] and single-bit forms", () => {
    expect(parseBitRange("[15:8]")).toEqual({ lsb: 8, msb: 15 });
    expect(parseBitRange("[3:3]")).toEqual({ lsb: 3, msb: 3 });
    expect(parseBitRange("[0]")).toEqual({ lsb: 0, msb: 0 });
    expect(parseBitRange("garbage")).toBeUndefined();
  });

  it("formatBits renders single bits and ranges", () => {
    expect(formatBits(0, 0)).toBe("0");
    expect(formatBits(3, 3)).toBe("3");
    expect(formatBits(0, 31)).toBe("[31:0]");
    expect(formatBits(8, 15)).toBe("[15:8]");
  });

  it("asArray normalises undefined, scalar and array", () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("x")).toEqual(["x"]);
    expect(asArray([1, 2])).toEqual([1, 2]);
  });
});
