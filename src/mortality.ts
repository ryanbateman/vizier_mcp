// fortress_mortality — who have we lost?
//
// Pure aggregator that takes already-joined Core dead-units + RFR creature
// data and returns a structured mortality audit. Composes the same join
// pattern as describe_unit / assess_militia: Core ListUnits supplies the
// structured name + decoded deathFlags + deathId; RFR GetUnitList supplies
// position + wounds + blood.
//
// RFR boundary disclosed in the tool description: no "killed by"
// attribution, no manner-of-death narrative — those live in the
// RunLua-blocked event log.

import type { ResolvedName, UnitBase } from "./dfhack/proto-types.js";
import type { WoundSummary } from "./describe-unit.js";

interface RfrInput {
  id?: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  bloodCount?: number;
  bloodMax?: number;
  wounds?: Array<{
    parts?: Array<{
      bodyPartId?: number;
      globalLayerIdx?: number;
      layerIdx?: number;
    }>;
    severedPart?: boolean;
  }>;
}

export interface DeadUnit {
  unitId: number;
  name?: ResolvedName;
  raceName?: string;
  profession?: string;
  /** Higher = more recent (DF's monotonic death-event id). May be -1 if unknown. */
  deathId?: number;
  position: { x?: number; y?: number; z?: number };
  /** Already-decoded death-info flag names (e.g. "killed", "starvation"). */
  deathFlagsNames: string[];
  bloodCount?: number;
  bloodMax?: number;
  wounds: WoundSummary[];
  severedPartCount: number;
}

export interface MortalityReport {
  total: number;
  byRace: Record<string, number>;
  byProfession: Record<string, number>;
  /** Ordered by deathId descending (most recent first) if available. */
  dead: DeadUnit[];
}

function severedCount(wounds: DeadUnit["wounds"]): number {
  return wounds.filter((w) => w.severedPart === true).length;
}

function asWounds(rfr: RfrInput | undefined): WoundSummary[] {
  if (!rfr?.wounds) return [];
  return rfr.wounds.map((w) => ({
    parts: (w.parts ?? []).map((p) => ({
      bodyPartId: p.bodyPartId,
      globalLayerIdx: p.globalLayerIdx,
      layerIdx: p.layerIdx,
    })),
    ...(w.severedPart !== undefined ? { severedPart: w.severedPart } : {}),
  }));
}

/**
 * Build the mortality report from a Core dead-unit list (ListUnits dead:true)
 * and a map of RFR creature data keyed by unit id. Pure — no I/O. Ordered
 * by deathId descending so the most recent loss surfaces first.
 */
export function buildMortalityReport(
  deadCore: UnitBase[],
  rfrById: Map<number, RfrInput>,
): MortalityReport {
  const dead: DeadUnit[] = [];
  const byRace: Record<string, number> = {};
  const byProfession: Record<string, number> = {};

  for (const u of deadCore) {
    const unitId = (u as { unitId?: number }).unitId;
    if (typeof unitId !== "number") continue;
    const rfr = rfrById.get(unitId);
    const wounds = asWounds(rfr);
    const raceName = u.raceName ?? "(unknown)";
    const profession = u.professionName ?? "(unknown)";
    byRace[raceName] = (byRace[raceName] ?? 0) + 1;
    byProfession[profession] = (byProfession[profession] ?? 0) + 1;

    dead.push({
      unitId,
      name: u.name ? { ...u.name } : undefined,
      raceName: u.raceName,
      profession: u.professionName,
      deathId: u.deathId,
      position: {
        x: rfr?.posX,
        y: rfr?.posY,
        z: rfr?.posZ,
      },
      deathFlagsNames: u.deathFlagsNames ?? [],
      bloodCount: rfr?.bloodCount,
      bloodMax: rfr?.bloodMax,
      wounds,
      severedPartCount: severedCount(wounds),
    });
  }

  // Most recent first. Units without a deathId (defaulted -1 or absent)
  // bubble to the bottom so they don't displace useful information.
  dead.sort((a, b) => {
    const ad = typeof a.deathId === "number" ? a.deathId : -Infinity;
    const bd = typeof b.deathId === "number" ? b.deathId : -Infinity;
    if (ad === bd) return a.unitId - b.unitId;
    return bd - ad;
  });

  return {
    total: dead.length,
    byRace,
    byProfession,
    dead,
  };
}
