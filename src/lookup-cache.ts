import { getClient, callRpc, type DFHackClient } from "./dfhack/client.js";
import type {
  ListJobSkillsOut,
  ListEnumsOut,
  MaterialList,
  GetWorldInfoOut,
  CreatureRawList,
} from "./dfhack/proto-types.js";

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolved lookup tables consumed by enrichment transforms. These are derived
 * (re-shaped into Maps) from the raw reference datasets so unit/item responses
 * can be name-resolved server-side without the model issuing decode calls.
 */
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
  creature?: Map<number, string>;
};

/** Static reference datasets exposed verbatim via get_reference_data / resources. */
export type ReferenceKind =
  | "materials"
  | "item_types"
  | "enums"
  | "job_skills"
  | "creature_raws"
  | "plant_raws"
  | "building_defs"
  | "tiletypes"
  | "language";

export const REFERENCE_KINDS: ReferenceKind[] = [
  "materials",
  "item_types",
  "enums",
  "job_skills",
  "creature_raws",
  "plant_raws",
  "building_defs",
  "tiletypes",
  "language",
];

const REFERENCE_METHOD: Record<ReferenceKind, string> = {
  materials: "GetMaterialList",
  item_types: "GetItemList",
  enums: "ListEnums",
  job_skills: "ListJobSkills",
  creature_raws: "GetCreatureRaws",
  plant_raws: "GetPlantRaws",
  building_defs: "GetBuildingDefList",
  tiletypes: "GetTiletypeList",
  language: "GetLanguage",
};

// How often we are willing to spend a GetWorldInfo RPC to detect a save change.
// Within this window, cache hits cost zero RPCs.
const WORLD_CHECK_TTL_MS = 60_000;

let cachedLookups: LookupTables | null = null;
let cachedSaveId: string | null = null;
let lastWorldCheckAt = 0;
let lookupPromise: Promise<LookupTables> | null = null;

const referenceCache = new Map<ReferenceKind, unknown>();
const referencePromises = new Map<ReferenceKind, Promise<unknown>>();

// Clients we've already subscribed to for disconnect-driven invalidation.
const hookedClients = new WeakSet<DFHackClient>();

export function invalidateLookups(): void {
  cachedLookups = null;
  cachedSaveId = null;
  lastWorldCheckAt = 0;
  referenceCache.clear();
  referencePromises.clear();
}

/**
 * Subscribe (once per client instance) so that a lost/replaced connection
 * drops all cached data — a reconnect typically means DFHack/the save changed.
 */
function attachInvalidationHook(client: DFHackClient): void {
  if (hookedClients.has(client)) return;
  hookedClients.add(client);
  client.onStatusChange((status) => {
    if (status === "disconnected" || status === "error") {
      invalidateLookups();
    }
  });
}

/**
 * TTL-throttled save-change detection. Returns true if the cache is still
 * valid for the current world; invalidates and returns false otherwise.
 * Costs at most one GetWorldInfo RPC per WORLD_CHECK_TTL_MS.
 */
async function isCacheFresh(): Promise<boolean> {
  if (cachedSaveId === null) return false;
  if (Date.now() - lastWorldCheckAt < WORLD_CHECK_TTL_MS) return true;
  try {
    const info = await callRpc<GetWorldInfoOut>("GetWorldInfo");
    lastWorldCheckAt = Date.now();
    if (info.saveDir === cachedSaveId) return true;
    console.error(
      `[vizier-mcp] Cache invalidated: save changed from ${cachedSaveId} to ${info.saveDir}`,
    );
  } catch (err: unknown) {
    console.error(
      `[vizier-mcp] Could not verify world_id, invalidating cache: ${formatError(err)}`,
    );
  }
  invalidateLookups();
  return false;
}

export async function ensureLookups(): Promise<LookupTables> {
  const client = await getClient();
  attachInvalidationHook(client);

  if (cachedLookups && (await isCacheFresh())) {
    return cachedLookups;
  }

  if (lookupPromise) return lookupPromise;

  lookupPromise = (async () => {
    try {
      const [result, enums] = await Promise.all([
        callRpc<ListJobSkillsOut>("ListJobSkills"),
        callRpc<ListEnumsOut>("ListEnums"),
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
      const creature = new Map<number, string>();

      cachedLookups = {
        profession,
        skill,
        labor,
        unitFlags1,
        unitFlags2,
        unitFlags3,
        deathInfoFlags,
        material,
        itemType,
        creature,
      };

      const [matsResult, itemsResult, worldResult, creaturesResult] =
        await Promise.allSettled([
          callRpc<MaterialList>("GetMaterialList"),
          callRpc<MaterialList>("GetItemList"),
          callRpc<GetWorldInfoOut>("GetWorldInfo"),
          callRpc<CreatureRawList>("GetCreatureRaws"),
        ]);

      if (matsResult.status === "fulfilled") {
        for (const m of matsResult.value.materialList ?? []) {
          cachedLookups.material.set(`${m.matPair.matType}/${m.matPair.matIndex}`, m.name);
        }
        referenceCache.set("materials", matsResult.value);
      } else {
        console.error(
          `[vizier-mcp] Failed to load material lookups (GetMaterialList): ${formatError(matsResult.reason)}`,
        );
      }

      if (itemsResult.status === "fulfilled") {
        for (const i of itemsResult.value.materialList ?? []) {
          cachedLookups.itemType.set(`${i.matPair.matType}/${i.matPair.matIndex}`, i.id);
        }
        referenceCache.set("item_types", itemsResult.value);
      } else {
        console.error(
          `[vizier-mcp] Failed to load item type lookups (GetItemList): ${formatError(itemsResult.reason)}`,
        );
      }

      if (creaturesResult.status === "fulfilled") {
        for (const c of creaturesResult.value.creatureRaws ?? []) {
          const cname = c.name?.[0] ?? c.creatureId;
          if (cname) creature.set(c.index, cname);
        }
        referenceCache.set("creature_raws", creaturesResult.value);
      } else {
        console.error(
          `[vizier-mcp] Failed to load creature lookups (GetCreatureRaws): ${formatError(creaturesResult.reason)}`,
        );
      }

      if (worldResult.status === "fulfilled" && worldResult.value.saveDir) {
        cachedSaveId = worldResult.value.saveDir;
        lastWorldCheckAt = Date.now();
      } else {
        const reason =
          worldResult.status === "rejected"
            ? formatError(worldResult.reason)
            : "GetWorldInfo returned no save_dir";
        console.error(`[vizier-mcp] Failed to get save id for cache: ${reason}`);
      }

      return cachedLookups;
    } finally {
      lookupPromise = null;
    }
  })();

  return lookupPromise;
}

/**
 * Fetch a raw static reference dataset, cached per world. Reuses datasets
 * already pulled by ensureLookups (materials/item_types/creature_raws) so the
 * common "inspect a unit" flow costs no extra RPCs.
 */
export async function getReferenceDataset<T = unknown>(
  kind: ReferenceKind,
  force = false,
): Promise<T> {
  const client = await getClient();
  attachInvalidationHook(client);
  await isCacheFresh();

  if (!force && referenceCache.has(kind)) {
    return referenceCache.get(kind) as T;
  }

  const inFlight = referencePromises.get(kind);
  if (!force && inFlight) return inFlight as Promise<T>;

  const p = (async () => {
    try {
      const value = await callRpc<T>(REFERENCE_METHOD[kind]);
      referenceCache.set(kind, value);
      return value;
    } finally {
      referencePromises.delete(kind);
    }
  })();

  referencePromises.set(kind, p);
  return p;
}

/** Warm the lookup cache (e.g. just after a successful connect). Best-effort. */
export async function warmCache(): Promise<void> {
  try {
    await ensureLookups();
  } catch (err: unknown) {
    console.error(`[vizier-mcp] Cache warm failed (will retry lazily): ${formatError(err)}`);
  }
}
