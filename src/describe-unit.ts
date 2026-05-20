import type { CreatureRaw, UnitBase } from "./dfhack/proto-types.js";

// Skill entries on a live unit may carry { id, level, experience, name, nameNoun }.
type SkillEntry = {
  id?: number;
  level?: number;
  experience?: number;
  name?: string;
  nameNoun?: string;
};

export interface WoundSummary {
  /** Pass-through; body-part name resolution isn't available yet. */
  parts: Array<{
    bodyPartId?: number;
    globalLayerIdx?: number;
    layerIdx?: number;
  }>;
  severedPart?: boolean;
}

export interface UnitDescription {
  id?: number;
  name: {
    firstName?: string;
    lastName?: string;
    englishName?: string;
    nickname?: string;
  };
  raceName?: string;
  genderName?: string;
  age?: number;
  profession?: { id?: number; name?: string };
  noblePositions: string[];
  position: { x?: number; y?: number; z?: number };
  body: {
    sizeBase?: number;
    sizeCur?: number;
    description?: string;
    isSoldier?: boolean;
  };
  health: {
    bloodCount?: number;
    bloodMax?: number;
    wounds: WoundSummary[];
    woundNote?: string;
  };
  skills: {
    top: Array<{ name: string; level: number }>;
    trainedCount: number;
    totalCount: number;
  };
  labors: string[];
  inventory: Array<Record<string, unknown>>;
  /** Echoed back so the LLM doesn't promise data we can't see. */
  notVisible: string[];
}

// RFR's UnitDefinition fields used here (proto2 names map to camelCase):
//   name (string), profession_id, noble_positions, pos_x/y/z, age,
//   is_soldier, size_info, appearance.physical_description,
//   blood_count, blood_max, wounds, inventory.
type RfrUnit = CreatureRaw & {
  id?: number;
  name?: string;
  professionId?: number;
  noblePositions?: string[];
  posX?: number;
  posY?: number;
  posZ?: number;
  age?: number;
  isSoldier?: boolean;
  sizeInfo?: { sizeBase?: number; sizeCur?: number };
  appearance?: { physicalDescription?: string };
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
};

function asNameObject(rfr: RfrUnit, core: UnitBase | undefined) {
  // Core's name is structured; RFR's is a single english string. Prefer
  // structured if available so the LLM gets first+last+english.
  if (core?.name && typeof core.name === "object") {
    return { ...core.name };
  }
  if (typeof rfr.name === "string") {
    return { englishName: rfr.name };
  }
  return {};
}

function topSkills(skills: SkillEntry[] | undefined, n: number) {
  if (!skills || skills.length === 0) return [];
  const named = skills.filter(
    (s): s is SkillEntry & { name: string; level: number } =>
      typeof s.name === "string" && typeof s.level === "number",
  );
  named.sort((a, b) => b.level - a.level);
  return named.slice(0, n).map((s) => ({ name: s.name, level: s.level }));
}

function countTrained(skills: SkillEntry[] | undefined): number {
  if (!skills) return 0;
  return skills.filter((s) => (s.level ?? 0) > 0).length;
}

function laborNames(
  labors: UnitBase["labors"] | undefined,
): string[] {
  if (!Array.isArray(labors)) return [];
  // After enrichment, labors are { id, name }; before, they're number[].
  // Defensive: handle both.
  return (labors as Array<unknown>)
    .map((l) => {
      if (typeof l === "object" && l !== null && "name" in l) {
        const name = (l as { name?: string }).name;
        return typeof name === "string" ? name : undefined;
      }
      return undefined;
    })
    .filter((n): n is string => typeof n === "string");
}

const NOT_VISIBLE_NOTE = [
  "current job (idle / mining / hauling)",
  "mood, stress, personality traits",
  "relationships and family",
  "thoughts, memories, preferences",
];

/**
 * Compose a single narrative-ready unit bundle from an RFR unit (rich
 * inventory/wounds/age) and a Core enriched unit (profession + skills +
 * labors + structured name). Pure; no I/O.
 *
 * Either side may be undefined — describe still returns a best-effort
 * shape with whatever was available. id resolution favours the RFR side
 * (it's the authoritative game id).
 */
export function buildUnitDescription(
  rfr: RfrUnit | undefined,
  core: UnitBase | undefined,
  options: { topSkills?: number } = {},
): UnitDescription {
  const topN = options.topSkills ?? 10;
  const r = rfr ?? ({} as RfrUnit);
  const c = core ?? ({} as UnitBase);

  const skillsArr = c.skills as SkillEntry[] | undefined;

  const wounds: WoundSummary[] = (r.wounds ?? []).map((w) => ({
    parts: (w.parts ?? []).map((p) => ({
      bodyPartId: p.bodyPartId,
      globalLayerIdx: p.globalLayerIdx,
      layerIdx: p.layerIdx,
    })),
    ...(w.severedPart !== undefined ? { severedPart: w.severedPart } : {}),
  }));

  return {
    id: r.id ?? (c as { unitId?: number }).unitId,
    name: asNameObject(r, c),
    raceName: c.raceName ?? r.raceName,
    genderName: c.genderName,
    age: r.age,
    profession:
      r.professionId !== undefined || c.professionName !== undefined
        ? { id: r.professionId ?? c.profession, name: c.professionName }
        : undefined,
    noblePositions: r.noblePositions ?? [],
    position: {
      x: r.posX ?? (c as { posX?: number }).posX,
      y: r.posY ?? (c as { posY?: number }).posY,
      z: r.posZ ?? (c as { posZ?: number }).posZ,
    },
    body: {
      sizeBase: r.sizeInfo?.sizeBase,
      sizeCur: r.sizeInfo?.sizeCur,
      description: r.appearance?.physicalDescription,
      isSoldier: r.isSoldier,
    },
    health: {
      bloodCount: r.bloodCount,
      bloodMax: r.bloodMax,
      wounds,
      ...(wounds.length > 0
        ? { woundNote: "Body-part ids are not yet resolved to names." }
        : {}),
    },
    skills: {
      top: topSkills(skillsArr, topN),
      trainedCount: countTrained(skillsArr),
      totalCount: skillsArr?.length ?? 0,
    },
    labors: laborNames(c.labors),
    inventory: (r.inventory ?? []) as Array<Record<string, unknown>>,
    notVisible: NOT_VISIBLE_NOTE,
  };
}
