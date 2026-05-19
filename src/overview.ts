import type { GetWorldInfoOut, UnitBase } from "./dfhack/proto-types.js";
import type { LookupTables } from "./lookup-cache.js";

/** Mirrors RemoteFortressReader.GetWorldInfoOut.Mode (proto2 enum). */
const MODE_LABELS: Record<number, string> = {
  0: "None",
  1: "Dwarf Fortress",
  2: "Adventure",
  3: "Legends",
};

/** Dwarf Fortress map blocks are a fixed 16×16 tiles. */
const TILES_PER_BLOCK = 16;

export interface MapInfoLike {
  blockSizeX?: number;
  blockSizeY?: number;
  blockSizeZ?: number;
  blockPosX?: number;
  blockPosY?: number;
  blockPosZ?: number;
}

export interface OverviewSkillEntry {
  unit: string;
  skill: string;
  level: number;
  profession?: string;
}

export interface FortressOverview {
  world: {
    name?: string;
    save?: string;
    mode?: string;
    civId?: number;
    siteId?: number;
    raceId?: number;
    raceName?: string;
  };
  map: {
    blocks: { x: number; y: number; z: number };
    embarkTiles: { x: number; y: number };
    zLevels: number;
    /** Block-coordinate origin from RFR. Block coords differ from unit posZ. */
    blockOrigin: { x: number; y: number; z: number };
  };
  population: {
    total: number;
    byProfession: Record<string, number>;
    byGender: { Male: number; Female: number; Unknown: number };
    notable: OverviewSkillEntry[];
  };
}

function nameOfWorld(worldName: unknown): string | undefined {
  if (!worldName) return undefined;
  if (typeof worldName === "string") return worldName;
  const w = worldName as { englishName?: string; lastName?: string };
  return w.englishName || w.lastName;
}

function bestUnitName(u: UnitBase): string {
  const n = u.name;
  if (!n) return "(unnamed)";
  if (typeof n === "string") return n;
  return n.englishName || n.firstName || n.nickname || n.lastName || "(unnamed)";
}

/**
 * Pure aggregation: take the world/map RPC results plus an already-enriched
 * unit list and reduce them to a small, bounded overview object. No I/O here
 * so this can be unit-tested without DFHack.
 */
export function buildFortressOverview(
  world: GetWorldInfoOut,
  map: MapInfoLike,
  units: UnitBase[],
  lookups: Pick<LookupTables, "creature">,
  options: { notableMinLevel?: number; notableLimit?: number } = {},
): FortressOverview {
  const notableMinLevel = options.notableMinLevel ?? 5;
  const notableLimit = options.notableLimit ?? 25;

  const raceId = (world as GetWorldInfoOut & { raceId?: number }).raceId;
  const raceName =
    raceId !== undefined ? lookups.creature?.get(raceId) : undefined;

  const blockX = map.blockSizeX ?? 0;
  const blockY = map.blockSizeY ?? 0;
  const blockZ = map.blockSizeZ ?? 0;

  const byProfession: Record<string, number> = {};
  const byGender = { Male: 0, Female: 0, Unknown: 0 };
  const notable: OverviewSkillEntry[] = [];

  for (const u of units) {
    const prof = u.professionName ?? "(unknown)";
    byProfession[prof] = (byProfession[prof] ?? 0) + 1;

    if (u.genderName === "Male") byGender.Male++;
    else if (u.genderName === "Female") byGender.Female++;
    else byGender.Unknown++;

    const skills = u.skills as
      | Array<{ name?: string; level?: number }>
      | undefined;
    if (!skills) continue;
    const unitLabel = bestUnitName(u);
    for (const s of skills) {
      if (s.name && (s.level ?? 0) >= notableMinLevel) {
        notable.push({
          unit: unitLabel,
          skill: s.name,
          level: s.level ?? 0,
          profession: u.professionName,
        });
      }
    }
  }

  notable.sort((a, b) => b.level - a.level);
  const trimmedNotable = notable.slice(0, notableLimit);

  return {
    world: {
      name: nameOfWorld(world.worldName),
      save: world.saveDir,
      mode: world.mode !== undefined
        ? MODE_LABELS[world.mode] ?? `Mode ${world.mode}`
        : undefined,
      civId: world.civId,
      siteId: world.siteId,
      raceId,
      raceName,
    },
    map: {
      blocks: { x: blockX, y: blockY, z: blockZ },
      embarkTiles: { x: blockX * TILES_PER_BLOCK, y: blockY * TILES_PER_BLOCK },
      zLevels: blockZ,
      blockOrigin: {
        x: map.blockPosX ?? 0,
        y: map.blockPosY ?? 0,
        z: map.blockPosZ ?? 0,
      },
    },
    population: {
      total: units.length,
      byProfession,
      byGender,
      notable: trimmedNotable,
    },
  };
}
