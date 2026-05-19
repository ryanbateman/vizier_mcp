import type { CreatureRaw, UnitBase } from "./dfhack/proto-types.js";
import type { LookupTables } from "./lookup-cache.js";

// Re-exported for backwards compatibility: cache logic now lives in
// lookup-cache.ts; this module holds only pure, synchronous transforms.
export type { LookupTables } from "./lookup-cache.js";
export {
  ensureLookups,
  invalidateLookups,
  warmCache,
  getReferenceDataset,
} from "./lookup-cache.js";

export function enrichInventory(unit: CreatureRaw, lookups: LookupTables) {
  if (unit.inventory) {
    for (const inv of unit.inventory) {
      if (inv.item) {
        const matKey = `${inv.item.material?.matType}/${inv.item.material?.matIndex}`;
        const matName = lookups.material.get(matKey);
        if (matName) inv.item.materialName = matName;

        const typeKey = `${inv.item.type?.matType}/${inv.item.type?.matIndex}`;
        const typeName = lookups.itemType.get(typeKey);
        if (typeName) inv.item.typeName = typeName;
      }
    }
  }
}

export function decodeFlags(value: number, map: Map<number, string>): string[] {
  const names: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (value & (1 << bit)) {
      const name = map.get(bit);
      if (name) names.push(name);
    }
  }
  return names;
}

export function resolveUnitNames(unit: UnitBase, lookups: LookupTables) {
  if (unit.profession !== undefined) {
    const p = lookups.profession.get(unit.profession);
    if (p) unit.professionName = p.caption;
  }
  if (unit.gender === 0) unit.genderName = "Female";
  else if (unit.gender === 1) unit.genderName = "Male";
  if (unit.flags1 !== undefined) unit.flags1Names = decodeFlags(unit.flags1, lookups.unitFlags1);
  if (unit.flags2 !== undefined) unit.flags2Names = decodeFlags(unit.flags2, lookups.unitFlags2);
  if (unit.flags3 !== undefined) unit.flags3Names = decodeFlags(unit.flags3, lookups.unitFlags3);
  if (unit.deathFlags !== undefined) unit.deathFlagsNames = decodeFlags(unit.deathFlags, lookups.deathInfoFlags);
  if (unit.skills) {
    for (const s of unit.skills) {
      const def = lookups.skill.get(s.id);
      if (def) {
        s.name = def.caption;
        s.nameNoun = def.captionNoun;
      }
    }
  }
  if (unit.labors) {
    unit.labors = (unit.labors as number[]).map((id: number) => {
      const def = lookups.labor.get(id);
      return { id, name: def?.caption ?? `Labor ${id}` };
    });
  }
  resolveCreatureRace(unit, lookups);
}

/**
 * Resolve a unit's race id to a readable creature name ("people" lookup).
 * RFR units carry race as a MatPair-like { matType, matIndex }; BasicApi units
 * may carry a plain numeric race. Best-effort: only sets raceName when known.
 */
export function resolveCreatureRace(
  unit: { race?: unknown; raceName?: string },
  lookups: LookupTables,
) {
  if (!lookups.creature) return;
  const race = unit.race as unknown;
  let index: number | undefined;
  if (typeof race === "number") index = race;
  else if (race && typeof race === "object") {
    const r = race as { matType?: number; matIndex?: number };
    index = r.matType ?? r.matIndex;
  }
  if (index === undefined) return;
  const name = lookups.creature.get(index);
  if (name) unit.raceName = name;
}
