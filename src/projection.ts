import type { UnitBase } from "./dfhack/proto-types.js";

export interface ProjectionOptions {
  /** Minimal roster: id, name, race, profession, top skill. Overrides verbose. */
  summary?: boolean;
  /** Full original shape (raw flag ints + skill nameNoun/experience kept). */
  verbose?: boolean;
}

/**
 * Roster shape returned when `summary: true`.
 */
export interface UnitSummary {
  id?: number;
  name?: string;
  raceName?: string;
  professionName?: string;
  topSkill: { name: string; level: number } | null;
}

// Skill entries on a live unit may carry { id, level, experience, name, nameNoun }
// (RFR sends level/experience even though proto-types.ts UnitBase doesn't declare
// them). Keep this loose so we can read & trim either shape.
type SkillEntry = {
  id?: number;
  level?: number;
  experience?: number;
  name?: string;
  nameNoun?: string;
};

function bestName(name: UnitBase["name"]): string | undefined {
  if (!name) return undefined;
  if (typeof name === "string") return name;
  return name.englishName || name.firstName || name.nickname || name.lastName;
}

function topSkill(skills: SkillEntry[] | undefined): UnitSummary["topSkill"] {
  if (!skills || skills.length === 0) return null;
  let best: SkillEntry | undefined;
  for (const s of skills) {
    const lvl = s.level ?? 0;
    if (!best || lvl > (best.level ?? 0)) best = s;
  }
  if (!best || !best.name || best.level === undefined) return null;
  return { name: best.name, level: best.level };
}

/**
 * Trim/reshape an enriched unit list for transport. Pure: returns new objects,
 * leaves the input array untouched so callers can re-project differently
 * without re-fetching.
 *
 * Modes (mutually exclusive, summary wins if both passed):
 *   - summary: tiny roster shape (UnitSummary[])
 *   - verbose: full enriched shape (returned as-is, structural clone)
 *   - default (neither): drop redundant raw flag ints (keep *Names) and trim
 *     skill entries to { name, level }; drop labor raw id (keep name).
 */
export function projectUnits(
  units: UnitBase[],
  opts: { summary: true; verbose?: boolean },
): UnitSummary[];
export function projectUnits(
  units: UnitBase[],
  opts?: { summary?: false | undefined; verbose?: boolean },
): UnitBase[];
export function projectUnits(
  units: UnitBase[],
  opts?: ProjectionOptions,
): UnitBase[] | UnitSummary[];
export function projectUnits(
  units: UnitBase[],
  opts: ProjectionOptions = {},
): UnitBase[] | UnitSummary[] {
  if (opts.summary) {
    return units.map((u): UnitSummary => {
      const unitId = (u as { unitId?: number; id?: number }).unitId
        ?? (u as { id?: number }).id;
      return {
        id: unitId,
        name: bestName(u.name),
        raceName: u.raceName,
        professionName: u.professionName,
        topSkill: topSkill(u.skills as SkillEntry[] | undefined),
      };
    });
  }
  if (opts.verbose) {
    // Structural clone so callers can mutate freely without side effects.
    return units.map((u) => ({ ...u }));
  }
  // Default: trim redundancies. Keep all resolved-name fields; drop the raw
  // flag ints when *Names are present; trim skill entries; drop labor ids.
  return units.map((u) => projectDefault(u));
}

function projectDefault(u: UnitBase): UnitBase {
  const out: Record<string, unknown> = { ...u };

  // Drop raw flag ints when the decoded *Names array is present. The decoded
  // names are strictly more useful and the raw int is the bulk of the noise.
  if (out.flags1Names !== undefined) delete out.flags1;
  if (out.flags2Names !== undefined) delete out.flags2;
  if (out.flags3Names !== undefined) delete out.flags3;
  if (out.deathFlagsNames !== undefined) delete out.deathFlags;

  // Trim skills: keep { name, level }. Drop id (only useful for set_unit_labors,
  // which addresses labors not skills), nameNoun (redundant with name), and
  // experience (rarely needed and verbose).
  if (Array.isArray(out.skills)) {
    out.skills = (out.skills as SkillEntry[])
      .map((s) => {
        const trimmed: { name?: string; level?: number } = {};
        if (s.name !== undefined) trimmed.name = s.name;
        if (s.level !== undefined) trimmed.level = s.level;
        return trimmed;
      })
      .filter((s) => s.name !== undefined);
  }

  // Trim labors: keep { name }. id is redundant for read-only descriptions;
  // set_unit_labors callers can use get_reference_data kind=job_skills.
  if (Array.isArray(out.labors)) {
    out.labors = (out.labors as Array<{ id?: number; name?: string }>)
      .map((l) => (l.name !== undefined ? { name: l.name } : l))
      .filter((l) => (l as { name?: string }).name !== undefined);
  }

  return out as UnitBase;
}
