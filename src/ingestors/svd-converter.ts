import { XMLParser } from "fast-xml-parser";

/**
 * CMSIS-SVD (System View Description) → markdown converter.
 *
 * One `.svd` file describes a whole MCU: a flat list of `<peripheral>`
 * elements, each with a base address, optional interrupts, and a tree of
 * registers (possibly nested in `<cluster>` elements) and fields. This
 * module turns that single file into one markdown page per peripheral plus
 * a per-device `index.md`, so a register-map query ("USBD TASKS_STARTEPIN
 * offset", "SPIM INTENSET END bit") is a plain grep.
 *
 * Why the ingestor layer rather than a DocNormaliser: like
 * `asciidoc-converter.ts` and `openapi-converter.ts`, the transform is
 * structural (1 file → N files), so it needs the whole `.svd` at once and
 * is invoked from `GitIngestor`, not the per-file normaliser pipeline.
 *
 * XML parsing uses `fast-xml-parser` (the one real XML dep in this repo's
 * runtime; the sitemap helpers are regex-based by design but SVD's nested
 * structure and escaped descriptions need a real parser). Values are kept
 * as strings (`parseTagValue: false`) so hex literals like `0x40027000`
 * survive verbatim instead of being coerced to decimal numbers.
 */

export interface ConvertedFile {
  path: string;
  content: string;
}

// ─── Parsed model ─────────────────────────────────────────────────

interface EnumeratedValue {
  name: string;
  description?: string;
  value?: string;
}

interface Field {
  name: string;
  description?: string;
  lsb: number;
  msb: number;
  access?: string;
  enumeratedValues: EnumeratedValue[];
}

interface Register {
  name: string;
  dimName?: string;
  description?: string;
  addressOffset: number;
  dim?: number;
  dimIncrement?: number;
  dimIndex?: string[];
  access?: string;
  resetValue?: string;
  fields: Field[];
}

/** A `<cluster>` is a group of registers sharing an extra address offset. */
interface Cluster {
  name: string;
  description?: string;
  addressOffset: number;
  children: Array<Register | Cluster>;
}

interface Interrupt {
  name: string;
  description?: string;
  value: number;
}

interface Peripheral {
  name: string;
  description?: string;
  baseAddress?: number;
  derivedFrom?: string;
  access?: string;
  resetValue?: string;
  interrupts: Interrupt[];
  children: Array<Register | Cluster>;
}

interface Device {
  name: string;
  description?: string;
  access: string;
  resetValue: string;
  peripherals: Peripheral[];
}

// ─── Small pure helpers (exported for unit tests) ─────────────────

export function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse a numeric string: hex (`0x...`) or decimal. NaN when unparsable. */
export function parseNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = String(s).trim();
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^[+-]?[0-9]+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

/** Parse an SVD `dimIndex` like "0,1,2" / "0-7" / "0-3,5" into index tokens. */
export function parseDimIndex(s: string | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const part of s.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\S+)-(\S+)$/.exec(t);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (!Number.isNaN(a) && !Number.isNaN(b) && a <= b && b - a < 10_000) {
        for (let i = a; i <= b; i++) out.push(String(i));
      } else {
        out.push(t);
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Parse an SVD `bitRange` like "[31:16]" / "[3:3]" / "[0]" into msb/lsb. */
export function parseBitRange(s: string): { lsb: number; msb: number } | undefined {
  const m = /^\s*\[\s*(\d+)\s*(?::\s*(\d+)\s*)?\]\s*$/.exec(s);
  if (!m) return undefined;
  const a = parseInt(m[1], 10);
  const b = m[2] !== undefined ? parseInt(m[2], 10) : a;
  return { lsb: Math.min(a, b), msb: Math.max(a, b) };
}

/** Render a bit range: single bit `3`, multi-bit `[7:0]`. */
export function formatBits(lsb: number, msb: number): string {
  return msb === lsb ? String(lsb) : `[${msb}:${lsb}]`;
}

/** Collapse whitespace/newlines and escape markdown-table pipe characters. */
function cell(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** Collapse whitespace for prose (no table escaping). */
function text(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** `0x` + uppercase hex, no zero padding (offsets/addresses are computed). */
function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase()}`;
}

/** Filesystem-safe directory slug for a device name (lowercased). */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── Parsing ──────────────────────────────────────────────────────

const PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
};

function parseField(raw: any): Field {
  let lsb: number;
  let msb: number;
  const bitRange = raw.bitRange;
  if (typeof bitRange === "string" && bitRange.trim() !== "") {
    const r = parseBitRange(bitRange);
    if (r) {
      lsb = r.lsb;
      msb = r.msb;
    } else {
      lsb = 0;
      msb = -1;
    }
  } else if (raw.lsb !== undefined && raw.msb !== undefined) {
    lsb = parseNumber(raw.lsb);
    msb = parseNumber(raw.msb);
  } else if (raw.bitOffset !== undefined) {
    const off = parseNumber(raw.bitOffset);
    const width = raw.bitWidth !== undefined ? parseNumber(raw.bitWidth) : 1;
    lsb = off;
    msb = off + width - 1;
  } else {
    // No bit position at all (rare): render a placeholder range.
    lsb = 0;
    msb = -1;
  }

  const enumeratedValues: EnumeratedValue[] = [];
  for (const evBlock of asArray<any>(raw.enumeratedValues)) {
    for (const ev of asArray<any>(evBlock?.enumeratedValue)) {
      enumeratedValues.push({
        name: ev.name,
        description: ev.description,
        value: ev.value,
      });
    }
  }

  return {
    name: raw.name ?? "",
    description: raw.description,
    lsb,
    msb,
    access: raw.access,
    enumeratedValues,
  };
}

function parseRegister(raw: any): Register {
  const dimRaw = raw.dim;
  const dim = typeof dimRaw === "string" && dimRaw.trim() !== "" ? parseNumber(dimRaw) : undefined;
  const dimIncrementRaw = raw.dimIncrement;
  const dimIncrement =
    typeof dimIncrementRaw === "string" && dimIncrementRaw.trim() !== ""
      ? parseNumber(dimIncrementRaw)
      : undefined;
  return {
    name: raw.name ?? "",
    dimName: raw.dimName,
    description: raw.description,
    addressOffset: parseNumber(raw.addressOffset) || 0,
    dim: dim !== undefined && !Number.isNaN(dim) ? dim : undefined,
    dimIncrement: dimIncrement !== undefined && !Number.isNaN(dimIncrement) ? dimIncrement : undefined,
    dimIndex: parseDimIndex(raw.dimIndex),
    access: raw.access,
    resetValue: raw.resetValue,
    fields: asArray<any>(raw.fields?.field).map(parseField),
  };
}

function parseCluster(raw: any): Cluster {
  const children: Array<Register | Cluster> = [];
  for (const r of asArray<any>(raw.register)) children.push(parseRegister(r));
  for (const c of asArray<any>(raw.cluster)) children.push(parseCluster(c));
  return {
    name: raw.name ?? "",
    description: raw.description,
    addressOffset: parseNumber(raw.addressOffset) || 0,
    children,
  };
}

/** Parse the children of a `<registers>` block: a mix of register + cluster. */
function parseChildren(registersRaw: any): Array<Register | Cluster> {
  if (!registersRaw) return [];
  const out: Array<Register | Cluster> = [];
  for (const r of asArray<any>(registersRaw.register)) out.push(parseRegister(r));
  for (const c of asArray<any>(registersRaw.cluster)) out.push(parseCluster(c));
  return out;
}

function parseInterrupt(raw: any): Interrupt {
  return {
    name: raw.name ?? "",
    description: raw.description,
    value: parseNumber(raw.value) || 0,
  };
}

function parsePeripheral(raw: any): Peripheral {
  const regsRaw = raw.registers;
  const base = parseNumber(raw.baseAddress);
  return {
    name: raw.name ?? "",
    description: raw.description,
    baseAddress: Number.isNaN(base) ? undefined : base,
    derivedFrom: raw["@_derivedFrom"],
    access: raw.access,
    resetValue: raw.resetValue,
    interrupts: asArray<any>(raw.interrupt).map(parseInterrupt),
    children: parseChildren(regsRaw),
  };
}

/** Parse the whole `<device>` into a normalised model. */
function parseDevice(raw: any): Device {
  const d = raw.device ?? raw;
  return {
    name: d.name ?? "",
    description: d.description,
    access: d.access ?? "read-write",
    resetValue: d.resetValue ?? "0x00000000",
    peripherals: asArray<any>(d.peripherals?.peripheral).map(parsePeripheral),
  };
}

// ─── derivedFrom resolution ───────────────────────────────────────

/**
 * Resolve `<peripheral derivedFrom="X">`: inherit registers/clusters from
 * the referenced peripheral, but keep this peripheral's own base address,
 * description, access/reset overrides and interrupts (an interrupt the
 * derived peripheral declares wins over the base's - nRF52 SPIM1 declares
 * its own interrupt 4 and must not also inherit SPIM0's interrupt 3).
 */
function resolvePeripheral(
  p: Peripheral,
  map: ReadonlyMap<string, Peripheral>,
  stack: string[],
): Peripheral {
  const baseName = p.derivedFrom;
  if (!baseName) return p;
  const base = map.get(baseName);
  if (!base || stack.includes(p.name)) return p; // broken ref or cycle
  const resolvedBase = resolvePeripheral(base, map, [...stack, p.name]);

  const merge = <T extends { name: string }>(
    baseItems: readonly T[],
    ownItems: readonly T[],
  ): T[] => {
    const byName = new Map<string, T>();
    for (const item of baseItems) byName.set(item.name, item);
    for (const item of ownItems) byName.set(item.name, item);
    return [...byName.values()];
  };

  const registers = merge(
    resolvedBase.children.filter((c): c is Register => "fields" in c),
    p.children.filter((c): c is Register => "fields" in c),
  );
  const clusters = merge(
    resolvedBase.children.filter((c): c is Cluster => !("fields" in c)),
    p.children.filter((c): c is Cluster => !("fields" in c)),
  );

  return {
    ...p,
    description: p.description ?? resolvedBase.description,
    baseAddress: p.baseAddress ?? resolvedBase.baseAddress,
    access: p.access ?? resolvedBase.access,
    resetValue: p.resetValue ?? resolvedBase.resetValue,
    interrupts: p.interrupts.length > 0 ? p.interrupts : resolvedBase.interrupts,
    children: [...registers, ...clusters],
  };
}

// ─── Flattening + rendering ───────────────────────────────────────

/** A register with its absolute offset and cluster ancestry resolved. */
interface LocatedRegister {
  register: Register;
  offset: number; // peripheral-relative offset (cluster offsets folded in)
  clusterPath: string[];
}

function flattenChildren(
  children: Array<Register | Cluster>,
  baseOffset = 0,
  clusterPath: string[] = [],
): LocatedRegister[] {
  const out: LocatedRegister[] = [];
  for (const c of children) {
    if ("fields" in c) {
      out.push({ register: c, offset: baseOffset + c.addressOffset, clusterPath });
    } else {
      out.push(
        ...flattenChildren(c.children, baseOffset + c.addressOffset, [...clusterPath, c.name]),
      );
    }
  }
  return out;
}

/** Indices of a dim array: dimIndex tokens when present, else 0..dim-1. */
function registerIndices(r: Register): string[] {
  if (r.dimIndex && r.dimIndex.length > 0) return r.dimIndex;
  const n = r.dim ?? 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => String(i));
}

/** The name pattern for a register (dimName wins, else name). */
function namePattern(r: Register): string {
  return r.dimName ?? r.name;
}

/** Expand a register's name pattern with an index token. */
function expandName(r: Register, idx: string): string {
  return namePattern(r).replace("%s", idx);
}

function renderFieldDescription(field: Field): string {
  const desc = field.description ? text(field.description) : "";
  if (field.enumeratedValues.length === 0) return desc;
  const values = field.enumeratedValues
    .map((ev) => {
      const label = ev.value !== undefined ? `${ev.value} ${ev.name}` : ev.name;
      return `\`${cell(label)}\``;
    })
    .join(", ");
  const valuesStr = `Values: ${values}`;
  return desc ? `${desc}. ${valuesStr}` : valuesStr;
}

function renderFieldTable(fields: Field[], regAccess: string): string {
  const lines = ["| Bits | Name | Access | Description |", "|------|------|--------|-------------|"];
  for (const f of fields) {
    const bits = formatBits(f.lsb, f.msb);
    const access = f.access ?? regAccess;
    lines.push(`| ${bits} | ${cell(f.name)} | ${cell(access)} | ${cell(renderFieldDescription(f))} |`);
  }
  return lines.join("\n");
}

function renderRegisterDetail(located: LocatedRegister, access: string, reset: string): string {
  const r = located.register;
  const pattern = namePattern(r);
  const parts: string[] = [`## ${pattern}`, ""];

  let offsetLine = `Offset: \`${hex(located.offset)}\``;
  if (r.dim !== undefined) {
    const stride = r.dimIncrement ?? 0;
    offsetLine += ` (array of ${r.dim}, stride \`${hex(stride)}\`)`;
  }
  parts.push(offsetLine, "");

  if (located.clusterPath.length > 0) {
    parts.push(`Cluster: \`${located.clusterPath.join(".")}\``, "");
  }

  const regAccess = r.access ?? access;
  parts.push(`Access: \`${regAccess}\``, "");
  parts.push(`Reset: \`${r.resetValue ?? reset}\``);

  if (r.description) {
    parts.push("", text(r.description));
  }
  parts.push("");

  if (r.fields.length > 0) {
    parts.push(renderFieldTable(r.fields, regAccess));
  }

  return parts.join("\n").trimEnd() + "\n";
}

function renderPeripheral(device: Device, p: Peripheral): string {
  const heading = p.description
    ? `# ${device.name} ${p.name} - ${text(p.description)}`
    : `# ${device.name} ${p.name}`;
  const parts: string[] = [heading, ""];

  if (p.baseAddress !== undefined) {
    parts.push(`Base address: \`${hex(p.baseAddress)}\``, "");
  }
  if (p.derivedFrom) {
    parts.push(`Derived from: \`${p.derivedFrom}\``, "");
  }
  for (const irq of p.interrupts) {
    parts.push(`Interrupt: \`${irq.name}\` (${irq.value})`, "");
  }

  const periphAccess = p.access ?? device.access;
  const periphReset = p.resetValue ?? device.resetValue;

  const located = flattenChildren(p.children).sort((a, b) => a.offset - b.offset);
  if (located.length === 0) {
    return parts.join("\n").trimEnd() + "\n";
  }

  parts.push("## Register summary", "");
  parts.push(
    "| Register | Offset | Address | Access | Reset | Description |",
    "|----------|--------|---------|--------|-------|-------------|",
  );
  for (const loc of located) {
    const r = loc.register;
    const base = p.baseAddress ?? 0;
    for (const idx of registerIndices(r)) {
      // idx is a string token (e.g. "0" or "A"); only numeric dim indices shift the offset.
      const numericIdx = parseNumber(idx);
      const realOffset =
        r.dim !== undefined && !Number.isNaN(numericIdx)
          ? loc.offset + (r.dimIncrement ?? 0) * numericIdx
          : loc.offset;
      const name = expandName(r, idx);
      parts.push(
        `| ${cell(name)} | ${hex(realOffset)} | ${hex(base + realOffset)} | ${cell(
          r.access ?? periphAccess,
        )} | ${cell(r.resetValue ?? periphReset)} | ${cell(r.description ?? "")} |`,
      );
    }
  }

  parts.push("");
  for (const loc of located) {
    parts.push(renderRegisterDetail(loc, periphAccess, periphReset));
  }

  return parts.join("\n").trimEnd() + "\n";
}

function renderIndex(device: Device): string {
  const parts: string[] = [
    device.description ? `# ${device.name} - ${text(device.description)}` : `# ${device.name}`,
    "",
    "## Peripherals",
    "",
    "| Peripheral | Base address | Interrupt | Description |",
    "|------------|--------------|-----------|-------------|",
  ];
  for (const p of device.peripherals) {
    const base = p.baseAddress !== undefined ? hex(p.baseAddress) : "-";
    const irq = p.interrupts.length
      ? p.interrupts.map((i) => `${cell(i.name)} (${i.value})`).join(", ")
      : "-";
    parts.push(`| ${cell(p.name)} | ${base} | ${irq} | ${cell(p.description ?? "")} |`);
  }

  // Interrupt vector table: every (peripheral, interrupt) pair, by number.
  const rows: Array<{ value: number; name: string; peripheral: string }> = [];
  for (const p of device.peripherals) {
    for (const irq of p.interrupts) {
      rows.push({ value: irq.value, name: irq.name, peripheral: p.name });
    }
  }
  rows.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
  if (rows.length > 0) {
    parts.push("", "## Interrupt vector table", "", "| Number | Name | Peripheral |", "|--------|------|------------|");
    for (const r of rows) {
      parts.push(`| ${r.value} | ${cell(r.name)} | ${cell(r.peripheral)} |`);
    }
  }

  return parts.join("\n").trimEnd() + "\n";
}

// ─── Entry point ──────────────────────────────────────────────────

/**
 * Convert one `.svd` XML document into a set of markdown files:
 * `<deviceDir>/index.md` plus `<deviceDir>/<PERIPHERAL>.md` per peripheral.
 * `fallbackDeviceName` (the `.svd` filename base) is used when the SVD
 * has no `<name>` element.
 */
export function convertSvdToMarkdown(svdXml: string, fallbackDeviceName: string): ConvertedFile[] {
  const parser = new XMLParser(PARSER_OPTS);
  const raw = parser.parse(svdXml);
  const device = parseDevice(raw);

  const name = device.name.trim() || fallbackDeviceName;
  device.name = name;

  const byName = new Map<string, Peripheral>();
  for (const p of device.peripherals) byName.set(p.name, p);
  device.peripherals = device.peripherals.map((p) => resolvePeripheral(p, byName, []));

  const dir = slugify(name);
  const files: ConvertedFile[] = [{ path: `${dir}/index.md`, content: renderIndex(device) }];
  for (const p of device.peripherals) {
    const safe = p.name.replace(/[^A-Za-z0-9_.-]+/g, "_");
    files.push({ path: `${dir}/${safe}.md`, content: renderPeripheral(device, p) });
  }
  return files;
}
