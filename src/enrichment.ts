import { getClient } from "./dfhack/client.js";
import type { ListJobSkillsOut, ListEnumsOut, MaterialList, CreatureRaw, UnitBase, GetWorldInfoOut } from "./dfhack/proto-types.js";

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type LookupTables = {
  profession: Map<number, { key: string; caption: string }>;
  skill: Map<number, { key: string; caption: string; captionNoun: string }>;
  labor: Map<number, { key: string; caption: string }>;
  unitFlags1: Map<number, string>;
  unitFlags2: Map<number, string>;
  unitFlags3: Map<number, string>;
  deathInfoFlags: Map<number, string>;
  material: Map<string, string>;
  itemType: Map<string, string>;
};

let cachedLookups: LookupTables | null = null;
let cachedWorldId: number | null = null;
let lookupPromise: Promise<LookupTables> | null = null;

export function invalidateLookups(): void {
  cachedLookups = null;
  cachedWorldId = null;
}

export async function ensureLookups(): Promise<LookupTables> {
  if (cachedLookups && cachedWorldId !== null) {
    try {
      const client = await getClient();
      const info = await client.callTyped<GetWorldInfoOut>("GetWorldInfo");
      if (info.worldId === cachedWorldId) {
        return cachedLookups;
      }
      console.error(`[vizier-mcp] Lookup cache invalidated: world changed from ${cachedWorldId} to ${info.worldId}`);
      invalidateLookups();
    } catch (err: unknown) {
      console.error(`[vizier-mcp] Could not verify world_id, invalidating lookup cache: ${formatError(err)}`);
      invalidateLookups();
    }
  }

  if (lookupPromise) return lookupPromise;

  lookupPromise = (async () => {
    try {
      const client = await getClient();

      const [result, enums] = await Promise.all([
        client.callTyped<ListJobSkillsOut>("ListJobSkills"),
        client.callTyped<ListEnumsOut>("ListEnums"),
      ]);

      const profession = new Map<number, { key: string; caption: string }>();
      for (const p of result.profession ?? []) {
        profession.set(p.id, { key: p.key, caption: p.caption });
      }

      const skill = new Map<number, { key: string; caption: string; captionNoun: string }>();
      for (const s of result.skill ?? []) {
        skill.set(s.id, { key: s.key, caption: s.caption, captionNoun: s.captionNoun });
      }

      const labor = new Map<number, { key: string; caption: string }>();
      for (const l of result.labor ?? []) {
        labor.set(l.id, { key: l.key, caption: l.caption });
      }

      const unitFlags1 = new Map<number, string>();
      for (const f of enums.unitFlags1 ?? []) unitFlags1.set(f.value, f.name);
      const unitFlags2 = new Map<number, string>();
      for (const f of enums.unitFlags2 ?? []) unitFlags2.set(f.value, f.name);
      const unitFlags3 = new Map<number, string>();
      for (const f of enums.unitFlags3 ?? []) unitFlags3.set(f.value, f.name);
      const deathInfoFlags = new Map<number, string>();
      for (const f of enums.deathInfoFlags ?? []) deathInfoFlags.set(f.value, f.name);

      const material = new Map<string, string>();
      const itemType = new Map<string, string>();

      cachedLookups = { profession, skill, labor, unitFlags1, unitFlags2, unitFlags3, deathInfoFlags, material, itemType };

      const [matsResult, itemsResult, worldResult] = await Promise.allSettled([
        client.callTyped<MaterialList>("GetMaterialList"),
        client.callTyped<MaterialList>("GetItemList"),
        client.callTyped<GetWorldInfoOut>("GetWorldInfo"),
      ]);

      if (matsResult.status === "fulfilled") {
        for (const m of matsResult.value.materialList ?? []) {
          cachedLookups.material.set(`${m.matPair.matType}/${m.matPair.matIndex}`, m.name);
        }
      } else {
        console.error(`[vizier-mcp] Failed to load material lookups (GetMaterialList): ${formatError(matsResult.reason)}`);
      }

      if (itemsResult.status === "fulfilled") {
        for (const i of itemsResult.value.materialList ?? []) {
          cachedLookups.itemType.set(`${i.matPair.matType}/${i.matPair.matIndex}`, i.id);
        }
      } else {
        console.error(`[vizier-mcp] Failed to load item type lookups (GetItemList): ${formatError(itemsResult.reason)}`);
      }

      if (worldResult.status === "fulfilled") {
        cachedWorldId = worldResult.value.worldId;
      } else {
        console.error(`[vizier-mcp] Failed to get world_id for cache: ${formatError(worldResult.reason)}`);
      }

      return cachedLookups;
    } finally {
      lookupPromise = null;
    }
  })();

  return lookupPromise;
}

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
}