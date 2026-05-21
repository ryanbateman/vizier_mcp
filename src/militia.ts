// assess_militia composes squads + per-unit skills + per-unit inventory
// into a readiness report. Pure aggregator: takes already-joined data,
// emits a structured shape with per-soldier and per-squad rollups.

import type { ResolvedName } from "./dfhack/proto-types.js";

type SkillEntry = {
  id?: number;
  level?: number;
  name?: string;
  nameNoun?: string;
};

type InventoryEntry = {
  mode?: number;
  bodyPartId?: number;
  item?: {
    typeName?: string;
    materialName?: string;
  };
};

/**
 * Already-joined input shape. Each soldier carries enough to evaluate
 * readiness without further lookups.
 */
export interface SoldierInput {
  unitId: number;
  name?: ResolvedName;          // structured per project convention
  professionName?: string;
  isSoldier?: boolean;
  skills?: SkillEntry[];
  inventory?: InventoryEntry[];
}

export interface SquadInput {
  squadId: number;
  alias?: string;
  /** NameInfo passthrough; we render via englishName / firstName fallback. */
  name?: {
    firstName?: string;
    lastName?: string;
    englishName?: string;
    nickname?: string;
  };
  memberIds: number[];
}

export interface CombatSkill {
  name: string;
  level: number;
}

export interface EquipmentSlots {
  head?: string;       // resolved item typeName (e.g. "HELM/ITEM_HELM_HELM")
  body?: string;       // ARMOR/...
  legs?: string;       // PANTS/...
  hands?: string;      // GLOVES/...
  feet?: string;       // SHOES/...
}

export interface SoldierReadiness {
  unitId: number;
  name?: ResolvedName;
  profession?: string;
  combatSkills: CombatSkill[];
  /** Best weapon-skill level the soldier has, if any. */
  topWeapon?: CombatSkill;
  equipment: {
    weapon?: string;
    shield?: string;
    armor: EquipmentSlots;
    /** Slot keys missing entirely: "weapon", "shield", "head", "body", "legs", "hands", "feet". */
    missing: string[];
  };
  /** Equipped in every armor slot AND has a weapon. */
  fullyEquipped: boolean;
  /** Top combat skill (general or weapon) >= threshold. */
  trained: boolean;
  /** fullyEquipped && trained. */
  ready: boolean;
}

export interface SquadReadiness {
  squadId: number;
  squadName: string;             // alias preferred; falls back to NameInfo / "(unnamed)"
  members: SoldierReadiness[];
  rollups: {
    total: number;
    fullyEquipped: number;
    trained: number;
    ready: number;
  };
}

export interface MilitiaReport {
  squads: SquadReadiness[];
  /** isSoldier units that aren't in any squad — typically civilian draftees or unassigned. */
  unsquaddedSoldiers: SoldierReadiness[];
  /** Threshold used for "trained" classification (default 5). */
  trainedThreshold: number;
}

/**
 * Canonical combat skills as DF emits them (verified against the live game's
 * workforce_report output). Listed explicitly so the report doesn't pick up
 * arbitrary social skills as "combat" just because they're high-level.
 */
const GENERAL_COMBAT_SKILLS = new Set([
  "Fighting",
  "Dodging",
  "Shield",
  "Armor",
  "Discipline",
  "Observation",
  "Climbing",
  "Wrestling",
  "Misc. Object User",
  "Striking",
  "Kicking",
  "Biting",
]);

const WEAPON_SKILLS = new Set([
  "Sword",
  "Axe",
  "Hammer",
  "Mace",
  "Spear",
  "Pike",
  "Bow",
  "Crossbow",
  "Blowgun",
  "Throwing",
  "Knife",
  "Whip",
  "Lash",
]);

/** Item-type-name prefix → equipment slot key. */
function slotForType(typeName: string | undefined): keyof EquipmentSlots | "weapon" | "shield" | undefined {
  if (!typeName) return undefined;
  const head = typeName.split("/")[0];
  switch (head) {
    case "HELM":
      return "head";
    case "ARMOR":
      return "body";
    case "PANTS":
      return "legs";
    case "GLOVES":
      return "hands";
    case "SHOES":
      return "feet";
    case "WEAPON":
      return "weapon";
    case "SHIELD":
      return "shield";
    default:
      return undefined;
  }
}

const ALL_ARMOR_SLOTS: Array<keyof EquipmentSlots> = ["head", "body", "legs", "hands", "feet"];

function classifyEquipment(inventory: InventoryEntry[] | undefined): SoldierReadiness["equipment"] {
  const armor: EquipmentSlots = {};
  let weapon: string | undefined;
  let shield: string | undefined;
  for (const inv of inventory ?? []) {
    const t = inv.item?.typeName;
    const slot = slotForType(t);
    if (!slot || !t) continue;
    if (slot === "weapon") {
      // Keep the first weapon we see — soldiers typically carry one.
      if (!weapon) weapon = t;
    } else if (slot === "shield") {
      if (!shield) shield = t;
    } else {
      // Don't overwrite a previously-assigned armor slot. Multiple layers
      // can occupy one slot (sock + shoe), and the first one is fine for
      // a readiness check — we only care that *something* is there.
      if (!armor[slot]) armor[slot] = t;
    }
  }
  const missing: string[] = [];
  if (!weapon) missing.push("weapon");
  // Shield is desirable but not strictly required (two-handed weapons,
  // crossbows). Flag it as missing so the report shows it, but don't make
  // it block fullyEquipped on its own.
  if (!shield) missing.push("shield");
  for (const slot of ALL_ARMOR_SLOTS) {
    if (!armor[slot]) missing.push(slot);
  }
  return { weapon, shield, armor, missing };
}

function extractCombatSkills(skills: SkillEntry[] | undefined): {
  combatSkills: CombatSkill[];
  topWeapon?: CombatSkill;
} {
  if (!skills || skills.length === 0) return { combatSkills: [] };
  const out: CombatSkill[] = [];
  let topWeapon: CombatSkill | undefined;
  for (const s of skills) {
    if (typeof s.name !== "string") continue;
    const lvl = s.level ?? 0;
    if (lvl <= 0) continue;
    if (GENERAL_COMBAT_SKILLS.has(s.name) || WEAPON_SKILLS.has(s.name)) {
      out.push({ name: s.name, level: lvl });
    }
    if (WEAPON_SKILLS.has(s.name)) {
      if (!topWeapon || lvl > topWeapon.level) {
        topWeapon = { name: s.name, level: lvl };
      }
    }
  }
  out.sort((a, b) => b.level - a.level);
  return { combatSkills: out, topWeapon };
}

function squadDisplayName(squad: SquadInput): string {
  if (squad.alias && squad.alias.trim()) return squad.alias;
  const n = squad.name;
  if (n) return n.englishName || n.firstName || n.lastName || "(unnamed)";
  return "(unnamed)";
}

function readiness(
  soldier: SoldierInput,
  threshold: number,
): SoldierReadiness {
  const { combatSkills, topWeapon } = extractCombatSkills(soldier.skills);
  const equipment = classifyEquipment(soldier.inventory);
  // "Fully equipped" requires a weapon + every armor slot. Shield missing
  // doesn't block (some loadouts don't include one).
  const armorComplete = ALL_ARMOR_SLOTS.every((s) => equipment.armor[s]);
  const fullyEquipped = Boolean(equipment.weapon) && armorComplete;
  // "Trained" = at least one combat or weapon skill at/above threshold.
  const trained = combatSkills.length > 0 && combatSkills[0].level >= threshold;
  return {
    unitId: soldier.unitId,
    name: soldier.name ? { ...soldier.name } : undefined,
    profession: soldier.professionName,
    combatSkills,
    ...(topWeapon ? { topWeapon } : {}),
    equipment,
    fullyEquipped,
    trained,
    ready: fullyEquipped && trained,
  };
}

export interface MilitiaOptions {
  /** Top combat-skill level required to count as "trained" (default 5). */
  trainedThreshold?: number;
}

/**
 * Build the readiness report. Inputs are pre-joined:
 *   - squads: from ListSquads
 *   - soldiers: each entry already carries skills + inventory (RFR + Core join)
 *
 * Pure: deterministic ordering (squads by squadId, members by missing-slot
 * count then unitId so the worst-equipped surface first).
 */
export function buildMilitiaReport(
  squads: SquadInput[],
  soldiers: SoldierInput[],
  options: MilitiaOptions = {},
): MilitiaReport {
  const threshold = options.trainedThreshold ?? 5;
  const byId = new Map<number, SoldierInput>();
  for (const s of soldiers) byId.set(s.unitId, s);

  const claimed = new Set<number>();
  const squadReports: SquadReadiness[] = [];
  for (const squad of [...squads].sort((a, b) => a.squadId - b.squadId)) {
    const members: SoldierReadiness[] = [];
    for (const memberId of squad.memberIds) {
      claimed.add(memberId);
      const input = byId.get(memberId);
      if (!input) {
        // Squad lists an id we don't have unit data for — keep a stub so
        // the squad roster is still accurate. Equipment classification
        // shows everything as missing.
        members.push(readiness({ unitId: memberId }, threshold));
        continue;
      }
      members.push(readiness(input, threshold));
    }
    members.sort((a, b) => {
      const am = a.equipment.missing.length;
      const bm = b.equipment.missing.length;
      if (am !== bm) return bm - am; // worst first
      return a.unitId - b.unitId;
    });
    squadReports.push({
      squadId: squad.squadId,
      squadName: squadDisplayName(squad),
      members,
      rollups: {
        total: members.length,
        fullyEquipped: members.filter((m) => m.fullyEquipped).length,
        trained: members.filter((m) => m.trained).length,
        ready: members.filter((m) => m.ready).length,
      },
    });
  }

  const unsquaddedSoldiers: SoldierReadiness[] = [];
  for (const s of soldiers) {
    if (claimed.has(s.unitId)) continue;
    if (s.isSoldier) unsquaddedSoldiers.push(readiness(s, threshold));
  }
  unsquaddedSoldiers.sort((a, b) => a.unitId - b.unitId);

  return {
    squads: squadReports,
    unsquaddedSoldiers,
    trainedThreshold: threshold,
  };
}

