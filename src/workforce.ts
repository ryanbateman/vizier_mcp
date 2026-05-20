import type { UnitBase } from "./dfhack/proto-types.js";
import {
  PROFESSION_ALIGNED_SKILL,
  SKILL_EXPECTED_PROFESSION,
} from "./profession-skill-map.js";

type SkillEntry = {
  id?: number;
  level?: number;
  name?: string;
  nameNoun?: string;
  experience?: number;
};

export interface WorkforceMismatch {
  name: string;
  profession: string;
  topSkill: { name: string; level: number };
  alignedSkill?: { name: string; level: number };
}

export interface WorkforceLegend {
  name: string;
  skill: string;
  level: number;
  expectedProfession: string;
  actualProfession: string;
}

export interface WorkforceIdle {
  name: string;
  profession: string;
  topSkill?: { name: string; level: number };
}

export interface WorkforceReport {
  total: number;
  byProfession: Record<string, number>;
  underusedLegends: WorkforceLegend[];
  mismatches: WorkforceMismatch[];
  idleGeneralists: WorkforceIdle[];
  /** Single best practitioner per skill name (across the surveyed units). */
  skillTop: Record<string, { name: string; level: number }>;
  /** Roles that intentionally have no canonical craft skill alignment. */
  uncategorisedRoles: string[];
}

export interface WorkforceOptions {
  /** A skill at or above this level counts as "legendary" worth flagging. */
  legendThreshold?: number;
  /** A unit is "idle generalist" if no skill reaches this level. */
  idleThreshold?: number;
  /** Top skill must beat aligned skill by at least this much to be a mismatch. */
  mismatchDelta?: number;
}

function bestName(u: UnitBase): string {
  const n = u.name;
  if (!n) return "(unnamed)";
  if (typeof n === "string") return n;
  return n.englishName || n.firstName || n.nickname || n.lastName || "(unnamed)";
}

function topSkillOf(skills: SkillEntry[] | undefined): SkillEntry | undefined {
  if (!skills || skills.length === 0) return undefined;
  let best: SkillEntry | undefined;
  for (const s of skills) {
    if (typeof s.name !== "string") continue;
    const lvl = s.level ?? 0;
    if (!best || lvl > (best.level ?? 0)) best = s;
  }
  return best;
}

function findSkill(
  skills: SkillEntry[] | undefined,
  name: string,
): SkillEntry | undefined {
  if (!skills) return undefined;
  return skills.find((s) => s.name === name);
}

/**
 * Pure analysis. Input is an already-enriched unit list (profession+skills
 * mask applied). Output is a small, bounded report of the workforce shape.
 */
export function buildWorkforceReport(
  units: UnitBase[],
  options: WorkforceOptions = {},
): WorkforceReport {
  const legendThreshold = options.legendThreshold ?? 15;
  const idleThreshold = options.idleThreshold ?? 5;
  const mismatchDelta = options.mismatchDelta ?? 3;

  const byProfession: Record<string, number> = {};
  const mismatches: WorkforceMismatch[] = [];
  const underusedLegends: WorkforceLegend[] = [];
  const idleGeneralists: WorkforceIdle[] = [];
  const skillTop: Record<string, { name: string; level: number }> = {};
  const uncategorisedRoles = new Set<string>();

  for (const u of units) {
    const profession = u.professionName ?? "(unknown)";
    byProfession[profession] = (byProfession[profession] ?? 0) + 1;

    const skills = u.skills as SkillEntry[] | undefined;
    const unitLabel = bestName(u);

    // Per-skill best practitioner across the surveyed set.
    if (skills) {
      for (const s of skills) {
        if (typeof s.name !== "string") continue;
        const lvl = s.level ?? 0;
        if (lvl <= 0) continue;
        const prev = skillTop[s.name];
        if (!prev || lvl > prev.level) {
          skillTop[s.name] = { name: unitLabel, level: lvl };
        }
      }
    }

    const aligned = PROFESSION_ALIGNED_SKILL[profession];
    if (!aligned) {
      uncategorisedRoles.add(profession);
      continue; // Roles without a canonical craft skill skip the analysis.
    }

    const top = topSkillOf(skills);
    const alignedSkill = findSkill(skills, aligned);
    const alignedLevel = alignedSkill?.level ?? 0;

    // Idle generalist: no skill reaches the idle threshold at all.
    if (!top || (top.level ?? 0) < idleThreshold) {
      idleGeneralists.push({
        name: unitLabel,
        profession,
        ...(top && top.name
          ? { topSkill: { name: top.name, level: top.level ?? 0 } }
          : {}),
      });
      continue;
    }

    // Underused legend: top skill is legendary and is NOT the aligned skill.
    if (
      top.name &&
      typeof top.level === "number" &&
      top.level >= legendThreshold &&
      top.name !== aligned
    ) {
      underusedLegends.push({
        name: unitLabel,
        skill: top.name,
        level: top.level,
        expectedProfession:
          SKILL_EXPECTED_PROFESSION[top.name] ?? "(no canonical role)",
        actualProfession: profession,
      });
      // Don't double-count as a mismatch; legends are their own category.
      continue;
    }

    // Mismatch: top skill comfortably outclasses the aligned skill.
    if (
      top.name &&
      top.name !== aligned &&
      typeof top.level === "number" &&
      top.level - alignedLevel >= mismatchDelta
    ) {
      mismatches.push({
        name: unitLabel,
        profession,
        topSkill: { name: top.name, level: top.level },
        ...(alignedSkill && typeof alignedSkill.level === "number"
          ? { alignedSkill: { name: aligned, level: alignedSkill.level } }
          : {}),
      });
    }
  }

  // Stable ordering: highest-level offenders/heroes first.
  mismatches.sort((a, b) => b.topSkill.level - a.topSkill.level);
  underusedLegends.sort((a, b) => b.level - a.level);

  return {
    total: units.length,
    byProfession,
    underusedLegends,
    mismatches,
    idleGeneralists,
    skillTop,
    uncategorisedRoles: Array.from(uncategorisedRoles).sort(),
  };
}
