// World-generated musical instruments live in the GetItemList payload as
// MaterialDefinition entries with a populated `instrument` field. This module
// turns the raw cache slice into a narrative-ready report grouped by
// entity (civilisation) and instrument family.

import type { MaterialPair } from "./dfhack/proto-types.js";

export interface InstrumentPiece {
  type?: string;
  id?: string;
  name?: string;
  namePlural?: string;
}

export interface InstrumentRegister {
  pitchRangeMin?: number;
  pitchRangeMax?: number;
}

export interface InstrumentFlagsRaw {
  indefinitePitch?: boolean;
  placedAsBuilding?: boolean;
  metalMat?: boolean;
  stoneMat?: boolean;
  woodMat?: boolean;
  glassMat?: boolean;
  ceramicMat?: boolean;
  shellMat?: boolean;
  boneMat?: boolean;
}

export interface InstrumentDefRaw {
  flags?: InstrumentFlagsRaw;
  size?: number;
  value?: number;
  materialSize?: number;
  pieces?: InstrumentPiece[];
  pitchRangeMin?: number;
  pitchRangeMax?: number;
  volumeMbMin?: number;
  volumeMbMax?: number;
  soundProduction?: number[];
  soundProductionParm1?: string[];
  soundProductionParm2?: string[];
  pitchChoice?: number[];
  pitchChoiceParm1?: string[];
  pitchChoiceParm2?: string[];
  tuning?: number[];
  tuningParm?: string[];
  registers?: InstrumentRegister[];
  description?: string;
}

/** Shape of an `item_types` cache entry that may carry an instrument def. */
export interface ItemTypeEntry {
  matPair: MaterialPair;
  id: string;
  name?: string;
  instrument?: InstrumentDefRaw;
}

export type InstrumentFamily =
  | "keyboard"
  | "strings"
  | "wind"
  | "percussion"
  | "other";

export interface InstrumentSummary {
  id: string;            // e.g. "INSTRUMENT/ENT11 INK1"
  civ: string;           // entity prefix from the id, e.g. "ENT11"
  name: string;          // procedural name, e.g. "inen"
  family: InstrumentFamily;
  size?: number;
  value?: number;
  building: boolean;     // flags.placedAsBuilding
  pieces: number;        // pieces.length
  description?: string;
  /**
   * Materials DF permits this instrument to be built from. Sparse: most
   * procedural instruments have a single material baked into the
   * description (e.g. "huge ceramic instrument") with no flag set, so
   * this array is `[]` for them. Populated only for instruments that
   * accept multiple material categories. Read the description for the
   * actual material a built instance will be made of.
   */
  permittedMaterials: string[];
}

export interface InstrumentVerbose extends InstrumentSummary {
  /** Full structured InstrumentDef passthrough. */
  raw: InstrumentDefRaw;
}

export interface WorldInstrumentsReport<
  T extends InstrumentSummary = InstrumentSummary,
> {
  total: number;
  byCiv: Record<string, T[]>;
  byFamily: Record<InstrumentFamily, number>;
}

/**
 * Pull the family code (INK/INS/INW/INP) out of an instrument id like
 * "INSTRUMENT/ENT11 INK1". Anything unrecognised maps to "other".
 */
function familyFromId(id: string): InstrumentFamily {
  // Take the substring after the first "/" then strip the entity prefix:
  // "INSTRUMENT/ENT11 INK1" → "ENT11 INK1" → "INK1".
  const slash = id.indexOf("/");
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  const space = tail.indexOf(" ");
  const code = (space >= 0 ? tail.slice(space + 1) : tail).slice(0, 3);
  switch (code) {
    case "INK":
      return "keyboard";
    case "INS":
      return "strings";
    case "INW":
      return "wind";
    case "INP":
      return "percussion";
    default:
      return "other";
  }
}

/** Civ prefix from "INSTRUMENT/ENT11 INK1" → "ENT11". */
function civFromId(id: string): string {
  const slash = id.indexOf("/");
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  const space = tail.indexOf(" ");
  return space >= 0 ? tail.slice(0, space) : tail;
}

/** Decode the per-instrument material allow-list flags into readable names. */
function permittedMaterialsFromFlags(flags?: InstrumentFlagsRaw): string[] {
  if (!flags) return [];
  const out: string[] = [];
  if (flags.metalMat) out.push("metal");
  if (flags.stoneMat) out.push("stone");
  if (flags.woodMat) out.push("wood");
  if (flags.glassMat) out.push("glass");
  if (flags.ceramicMat) out.push("ceramic");
  if (flags.shellMat) out.push("shell");
  if (flags.boneMat) out.push("bone");
  return out;
}

function summarise(entry: ItemTypeEntry): InstrumentSummary | undefined {
  const inst = entry.instrument;
  if (!inst) return undefined;
  return {
    id: entry.id,
    civ: civFromId(entry.id),
    name: entry.name ?? "",
    family: familyFromId(entry.id),
    size: inst.size,
    value: inst.value,
    building: inst.flags?.placedAsBuilding === true,
    pieces: inst.pieces?.length ?? 0,
    description: inst.description,
    permittedMaterials: permittedMaterialsFromFlags(inst.flags),
  };
}

/**
 * Build the world-instruments report from the cached item_types list.
 * Pure: no I/O, deterministic ordering (sorted within each civ by family
 * then name) so test assertions don't depend on RFR's emission order.
 */
export function buildWorldInstruments(
  itemTypes: ItemTypeEntry[],
  options: { verbose?: boolean } = {},
): WorldInstrumentsReport | WorldInstrumentsReport<InstrumentVerbose> {
  const byCiv: Record<string, InstrumentSummary[]> = {};
  const byFamily: Record<InstrumentFamily, number> = {
    keyboard: 0,
    strings: 0,
    wind: 0,
    percussion: 0,
    other: 0,
  };
  let total = 0;

  for (const entry of itemTypes) {
    const summary = summarise(entry);
    if (!summary) continue;
    total++;
    byFamily[summary.family]++;
    const enriched: InstrumentSummary | InstrumentVerbose = options.verbose
      ? { ...summary, raw: entry.instrument! }
      : summary;
    (byCiv[summary.civ] ??= []).push(enriched);
  }

  // Stable ordering within each civ: family group, then name.
  for (const civ of Object.keys(byCiv)) {
    byCiv[civ].sort((a, b) => {
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.name.localeCompare(b.name);
    });
  }

  return { total, byCiv, byFamily };
}
