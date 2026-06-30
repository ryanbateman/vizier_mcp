import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callToolTyped, jsonResult, errorResult } from "./helpers.js";
import { checkBlockVolume } from "../block-volume.js";

// RFR TileDigDesignation enum (proto). Maps a friendly mode → the wire value.
export const DIG_MODE: Record<string, number> = {
  clear: 0, // NO_DIG (remove designation)
  mine: 1, // DEFAULT_DIG (dig out a wall)
  updown_stair: 2,
  channel: 3,
  ramp: 4,
  down_stair: 5,
  up_stair: 6,
};

const MAX_TILES = 4096;

interface MatPair { matType?: number; matIndex?: number }
interface MapBlock {
  mapX?: number; mapY?: number; mapZ?: number;
  magma?: number[]; water?: number[]; aquifer?: boolean[];
}
interface BlockListOut { mapBlocks?: MapBlock[] }

export type Tile = { x: number; y: number; z: number };

// Block coords for x/y, z-levels for z, max EXCLUSIVE (+1) — same convention
// as survey.ts. `margin` widens the tile box before conversion (for the
// neighbour-hazard scan).
function blockRange(b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, margin = 0) {
  return {
    minX: Math.floor((b.minX - margin) / 16),
    minY: Math.floor((b.minY - margin) / 16),
    minZ: b.minZ - margin,
    maxX: Math.floor((b.maxX + margin) / 16) + 1,
    maxY: Math.floor((b.maxY + margin) / 16) + 1,
    maxZ: b.maxZ + margin + 1,
  };
}

// Build the set of hazard tile keys (aquifer / magma / standing water) in the
// region covering `targets` + a 1-tile margin, so we can refuse a dig that
// would breach or sit next to one.
async function hazardSet(targets: Tile[]): Promise<Set<string>> {
  const xs = targets.map((t) => t.x), ys = targets.map((t) => t.y), zs = targets.map((t) => t.z);
  const bbox = { minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs), maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs) };
  const br = blockRange(bbox, 1);
  const guard = checkBlockVolume(br);
  if (!guard.ok) throw new Error(`hazard scan too large: ${guard.reason}`);
  // GetBlockList is change-driven; reset hashes for a reliable full read.
  await callToolTyped("ResetMapHashes", {});
  const res = await callToolTyped<BlockListOut>("GetBlockList", { ...br, blocksNeeded: 1000000 });
  const set = new Set<string>();
  for (const blk of res.mapBlocks ?? []) {
    const bx = blk.mapX ?? 0, by = blk.mapY ?? 0, bz = blk.mapZ ?? 0;
    for (let i = 0; i < 256; i++) {
      if (blk.aquifer?.[i] || (blk.magma?.[i] ?? 0) > 0 || (blk.water?.[i] ?? 0) > 0) {
        set.add(`${bx + (i % 16)},${by + Math.floor(i / 16)},${bz}`);
      }
    }
  }
  return set;
}

// Returns the first target whose own tile or a 6-neighbour is a hazard, else null.
export function firstHazardNear(targets: Tile[], hazards: Set<string>): { tile: Tile; hazardAt: string } | null {
  if (hazards.size === 0) return null;
  for (const t of targets) {
    const neigh = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const [dx, dy, dz] of neigh) {
      const key = `${t.x + dx},${t.y + dy},${t.z + dz}`;
      if (hazards.has(key)) return { tile: t, hazardAt: key };
    }
  }
  return null;
}

async function designate(targets: Tile[], mode: string, force: boolean) {
  if (targets.length === 0) return jsonResult({ status: "noop", reason: "no target tiles" });
  if (targets.length > MAX_TILES) return errorResult(new Error(`too many tiles (${targets.length} > ${MAX_TILES})`));
  const designation = DIG_MODE[mode];
  if (designation === undefined) return errorResult(new Error(`unknown mode '${mode}' (use ${Object.keys(DIG_MODE).join(", ")})`));

  if (mode !== "clear" && !force) {
    const haz = await hazardSet(targets);
    const hit = firstHazardNear(targets, haz);
    if (hit) {
      return jsonResult({
        status: "refused",
        reason: `hazard near target ${hit.tile.x},${hit.tile.y},${hit.tile.z}: a magma/aquifer/water tile at ${hit.hazardAt}. Digging here risks a flood. Pass force:true to override.`,
        hazardTiles: haz.size,
      });
    }
  }

  await callToolTyped<Record<string, unknown>>("SendDigCommand", {
    designation,
    locations: targets.map((t) => ({ x: t.x, y: t.y, z: t.z })),
  });
  return jsonResult({ status: "ok", mode, designation, tiles: targets.length });
}

const ACTION_NOTE =
  " WRITE action (registered only when VIZIER_ENABLE_ACTIONS=1). Designates tiles for digging via " +
  "the native SendDigCommand RPC — dwarves with the labor will then mine them. NOT trivially " +
  "reversible (mode 'clear' removes a pending designation, but already-mined tiles stay mined). " +
  "Refuses tiles on/next to aquifer/magma/water unless force:true. Survey first with survey_dig_site.";

export function registerDigTools(server: McpServer, options: { actionsEnabled: boolean }) {
  if (!options.actionsEnabled) return;

  const modeSchema = z
    .enum(["mine", "channel", "ramp", "up_stair", "down_stair", "updown_stair", "clear"])
    .describe("Dig mode: mine (dig wall), channel, ramp, up_stair/down_stair/updown_stair, or clear (remove designation)");

  server.tool(
    "dig_area",
    "Designate a rectangular box of tiles to dig (carve a room/corridor)." + ACTION_NOTE,
    {
      minX: z.number().int(), minY: z.number().int(), minZ: z.number().int(),
      maxX: z.number().int(), maxY: z.number().int(), maxZ: z.number().int(),
      mode: modeSchema,
      force: z.boolean().optional().describe("Override the hazard guard (default false)"),
    },
    async ({ minX, minY, minZ, maxX, maxY, maxZ, mode, force }) => {
      try {
        const targets: Tile[] = [];
        for (let zz = minZ; zz <= maxZ; zz++)
          for (let yy = minY; yy <= maxY; yy++)
            for (let xx = minX; xx <= maxX; xx++) targets.push({ x: xx, y: yy, z: zz });
        return await designate(targets, mode, force ?? false);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "dig_tiles",
    "Designate an explicit list of tiles to dig (irregular shapes)." + ACTION_NOTE,
    {
      tiles: z.array(z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() })).describe("Tiles to designate"),
      mode: modeSchema,
      force: z.boolean().optional().describe("Override the hazard guard (default false)"),
    },
    async ({ tiles, mode, force }) => {
      try {
        return await designate(tiles, mode, force ?? false);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
