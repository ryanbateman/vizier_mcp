// fortress_mortality — who have we lost?
//
// Pure aggregator over Core's ListUnits(dead:true) output. RFR is NOT
// consulted: RFR's GetUnitList only returns *active* units, so wounds
// and blood data never populates for corpses. We dropped that side
// entirely and rely on Core fields (position included).
//
// RFR boundary disclosed in the tool description: no "killed by"
// attribution, no manner-of-death narrative — those live in the
// RunLua-blocked event log.

import type { ResolvedName, UnitBase } from "./dfhack/proto-types.js";

export interface DeadUnit {
  unitId: number;
  name?: ResolvedName;
  raceName?: string;
  profession?: string;
  /** Higher = more recent (DF's monotonic death-event id). Missing for some
   * deaths (e.g. butchered livestock). Units without a deathId sort to the
   * bottom of the report. */
  deathId?: number;
  position: { x?: number; y?: number; z?: number };
  /** Already-decoded death-info flag names (e.g. "killed", "starvation"). */
  deathFlagsNames: string[];
}

export interface MortalityReport {
  total: number;
  byRace: Record<string, number>;
  byProfession: Record<string, number>;
  /** Ordered by deathId descending (most recent first); units without a
   * deathId bubble to the bottom. */
  dead: DeadUnit[];
}

/**
 * Build the mortality report from a Core dead-unit list (ListUnits dead:true).
 * Pure — no I/O.
 */
export function buildMortalityReport(deadCore: UnitBase[]): MortalityReport {
  const dead: DeadUnit[] = [];
  const byRace: Record<string, number> = {};
  const byProfession: Record<string, number> = {};

  for (const u of deadCore) {
    const unitId = (u as { unitId?: number }).unitId;
    if (typeof unitId !== "number") continue;
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
        x: u.posX,
        y: u.posY,
        z: u.posZ,
      },
      deathFlagsNames: u.deathFlagsNames ?? [],
    });
  }

  // Most recent first. Units without a deathId (defaulted -1 or absent)
  // bubble to the bottom.
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
