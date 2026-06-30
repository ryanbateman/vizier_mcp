import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callToolTyped, jsonResult, errorResult } from "./helpers.js";
import { checkBlockVolume } from "../block-volume.js";
import { ensureLookups } from "../lookup-cache.js";

// RFR TiletypeShape enum values we classify on (stable in RemoteFortressReader).
const SHAPE = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 4,
  FORTIFICATION: 5,
  STAIR_UP: 6,
  STAIR_DOWN: 7,
  STAIR_UPDOWN: 8,
  RAMP: 9,
} as const;

interface Tiletype {
  id: number;
  name?: string;
  shape?: number;
  material?: number;
}
interface TiletypeListOut {
  tiletypeList?: Tiletype[];
}
interface MatPair {
  matType?: number;
  matIndex?: number;
}
interface BuildingInstance {
  index?: number;
  posXMin?: number;
  posYMin?: number;
  posZMin?: number;
  posXMax?: number;
  posYMax?: number;
  posZMax?: number;
  buildingType?: { buildingType?: number; buildingSubtype?: number; buildingCustom?: number };
  isRoom?: boolean;
  room?: { posX?: number; posY?: number; width?: number; height?: number };
  items?: unknown[];
}
interface MapBlock {
  mapX?: number;
  mapY?: number;
  mapZ?: number;
  tiles?: number[];
  materials?: MatPair[];
  veinMaterials?: MatPair[];
  magma?: number[];
  water?: number[];
  hidden?: boolean[];
  aquifer?: boolean[];
  treePercent?: number[];
  tileDigDesignation?: (number | string)[];
  buildings?: BuildingInstance[];
}
interface BlockListOut {
  mapBlocks?: MapBlock[];
}

// Tile bounding box → the block range that covers it. GetBlockList takes BLOCK
// coords for x/y (each block = 16 tiles), z-levels for z, and treats max as
// EXCLUSIVE on every axis — so the covering range adds +1 to each max.
function blockRange(b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) {
  return {
    minX: Math.floor(b.minX / 16),
    minY: Math.floor(b.minY / 16),
    minZ: b.minZ,
    maxX: Math.floor(b.maxX / 16) + 1,
    maxY: Math.floor(b.maxY / 16) + 1,
    maxZ: b.maxZ + 1,
  };
}

// GetBlockList is change-driven (returns only blocks changed since the last
// call on this connection). Survey/dig need the full current state every time,
// so reset the hashes first to force a complete resend.
async function freshBlocks(br: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): Promise<BlockListOut> {
  await callToolTyped("ResetMapHashes", {});
  return callToolTyped<BlockListOut>("GetBlockList", { ...br, blocksNeeded: 1000000 });
}

const HAZARD_CAP = 40;
const VEIN_SAMPLE_CAP = 3;

const tileBoxSchema = {
  minX: z.number().int().describe("Min tile X"),
  minY: z.number().int().describe("Min tile Y"),
  minZ: z.number().int().describe("Min z-level"),
  maxX: z.number().int().describe("Max tile X (inclusive)"),
  maxY: z.number().int().describe("Max tile Y (inclusive)"),
  maxZ: z.number().int().describe("Max z-level (inclusive)"),
};

export function registerSurveyTools(server: McpServer) {
  server.tool(
    "survey_dig_site",
    "Survey a region of the map (TILE coordinates) to plan digging: per z-level counts of " +
      "diggable rock walls, open floor/space, hidden/unrevealed tiles, and already-designated " +
      "tiles; the named ore/mineral VEINS present (with a sample coordinate); and a list of " +
      "HAZARD tiles (aquifer / magma / standing water) so you can avoid breaching them. " +
      "This is the 'find me the mountain / where's the ore / is it safe to dig here' tool. " +
      "Read-only. Bounded by VIZIER_MAX_BLOCK_VOLUME like get_block_list.",
    tileBoxSchema,
    async (box) => {
      try {
        const br = blockRange(box);
        const guard = checkBlockVolume(br);
        if (!guard.ok) return errorResult(new Error(guard.reason));

        const blocksRes = await freshBlocks(br);
        const [ttRes, lookups] = await Promise.all([
          callToolTyped<TiletypeListOut>("GetTiletypeList"),
          ensureLookups(),
        ]);

        const tt = new Map<number, Tiletype>();
        for (const t of ttRes.tiletypeList ?? []) tt.set(t.id, t);

        // Per-z accumulator.
        type Z = {
          diggableWalls: number;
          openFloor: number;
          openSpace: number;
          hidden: number;
          designated: number;
          trees: number;
        };
        const byZ = new Map<number, Z>();
        const z = (lvl: number): Z => {
          let v = byZ.get(lvl);
          if (!v) { v = { diggableWalls: 0, openFloor: 0, openSpace: 0, hidden: 0, designated: 0, trees: 0 }; byZ.set(lvl, v); }
          return v;
        };
        const hazards: { kind: string; x: number; y: number; z: number }[] = [];
        const veins = new Map<string, { count: number; samples: { x: number; y: number; z: number }[] }>();

        const inBox = (x: number, y: number) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

        for (const blk of blocksRes.mapBlocks ?? []) {
          const bx = (blk.mapX ?? 0), by = (blk.mapY ?? 0), bz = (blk.mapZ ?? 0);
          if (bz < box.minZ || bz > box.maxZ) continue;
          const tiles = blk.tiles ?? [];
          for (let i = 0; i < tiles.length; i++) {
            const tx = bx + (i % 16);
            const ty = by + Math.floor(i / 16);
            if (!inBox(tx, ty)) continue;
            const acc = z(bz);
            const shape = tt.get(tiles[i])?.shape ?? -1;
            const hidden = blk.hidden?.[i] === true;
            if (hidden) acc.hidden++;
            const dig = blk.tileDigDesignation?.[i];
            if (dig && dig !== 0 && dig !== "NO_DIG") acc.designated++;
            if ((blk.treePercent?.[i] ?? 0) > 0) acc.trees++;

            // Hazards.
            if (blk.aquifer?.[i]) hazards.length < HAZARD_CAP && hazards.push({ kind: "aquifer", x: tx, y: ty, z: bz });
            else if ((blk.magma?.[i] ?? 0) > 0) hazards.length < HAZARD_CAP && hazards.push({ kind: "magma", x: tx, y: ty, z: bz });
            else if ((blk.water?.[i] ?? 0) > 0) hazards.length < HAZARD_CAP && hazards.push({ kind: "water", x: tx, y: ty, z: bz });

            if (shape === SHAPE.WALL) {
              acc.diggableWalls++;
              // Ore/mineral vein in this wall?
              const vein = blk.veinMaterials?.[i];
              if (vein && (vein.matType ?? -1) >= 0 && (vein.matIndex ?? -1) >= 0) {
                const key = `${vein.matType}/${vein.matIndex}`;
                const name = lookups.material.get(key) ?? key;
                let v = veins.get(name);
                if (!v) { v = { count: 0, samples: [] }; veins.set(name, v); }
                v.count++;
                if (v.samples.length < VEIN_SAMPLE_CAP) v.samples.push({ x: tx, y: ty, z: bz });
              }
            } else if (shape === SHAPE.FLOOR || shape === SHAPE.RAMP || shape >= SHAPE.STAIR_UP && shape <= SHAPE.STAIR_UPDOWN) {
              acc.openFloor++;
            } else if (shape === SHAPE.EMPTY) {
              acc.openSpace++;
            }
          }
        }

        const perZ = [...byZ.entries()].sort((a, b) => b[0] - a[0]).map(([lvl, v]) => ({ z: lvl, ...v }));
        const veinList = [...veins.entries()].sort((a, b) => b[1].count - a[1].count).map(([material, v]) => ({ material, tiles: v.count, samples: v.samples }));

        return jsonResult({
          box,
          perZLevel: perZ,
          oreVeins: veinList,
          hazards: { count: hazards.length, capped: hazards.length >= HAZARD_CAP, tiles: hazards },
          note: "diggableWalls = mineable rock. Avoid designating into/next to hazard tiles. hidden tiles are unrevealed (dig blind at your peril).",
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_buildings",
    "List buildings and defined rooms in a region (TILE coordinates) — workshops, furniture, " +
      "stockpiles, etc., with their position/extent, whether they define a room (is_room) and " +
      "the room rectangle, and how many items they hold. The 'what have I already built / where " +
      "are my existing rooms' tool. Read-only.",
    tileBoxSchema,
    async (box) => {
      try {
        const br = blockRange(box);
        const guard = checkBlockVolume(br);
        if (!guard.ok) return errorResult(new Error(guard.reason));
        const blocksRes = await freshBlocks(br);

        // Buildings can span multiple blocks; dedupe by index.
        const seen = new Map<number, BuildingInstance>();
        for (const blk of blocksRes.mapBlocks ?? []) {
          for (const b of blk.buildings ?? []) {
            if (typeof b.index === "number" && !seen.has(b.index)) seen.set(b.index, b);
          }
        }
        const buildings = [...seen.values()]
          .filter((b) => (b.posXMin ?? 0) <= box.maxX && (b.posXMax ?? 0) >= box.minX && (b.posYMin ?? 0) <= box.maxY && (b.posYMax ?? 0) >= box.minY)
          .map((b) => ({
            index: b.index,
            type: b.buildingType?.buildingType,
            subtype: b.buildingType?.buildingSubtype,
            pos: { xMin: b.posXMin, yMin: b.posYMin, zMin: b.posZMin, xMax: b.posXMax, yMax: b.posYMax, zMax: b.posZMax },
            isRoom: b.isRoom ?? false,
            room: b.room,
            itemCount: b.items?.length ?? 0,
          }));

        return jsonResult({ box, total: buildings.length, buildings });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
