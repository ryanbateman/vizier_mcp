import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callToolTyped, errorResult, jsonResult } from "./helpers.js";
import { sweepBlocks } from "../block-sweep.js";
import {
  buildItemCensus,
  type ItemTypeRef,
  type MaterialRef,
} from "../item-census.js";
import { getReferenceDataset } from "../lookup-cache.js";
import type {
  MapInfoOut,
  ViewInfoOut,
  BlockListOut,
} from "../dfhack/proto-types.js";

interface MaterialListLike {
  materialList?: Array<{
    matPair?: { matType?: number; matIndex?: number };
    id?: string;
    name?: string;
    instrument?: { value?: number };
  }>;
}

function toItemTypeRefs(raw: MaterialListLike | undefined): ItemTypeRef[] {
  const out: ItemTypeRef[] = [];
  for (const e of raw?.materialList ?? []) {
    const t = e.matPair?.matType;
    const i = e.matPair?.matIndex;
    if (typeof t !== "number" || typeof i !== "number") continue;
    out.push({
      matType: t,
      matIndex: i,
      id: e.id,
      name: e.name,
      baseValue: e.instrument?.value,
    });
  }
  return out;
}

function toMaterialRefs(raw: MaterialListLike | undefined): MaterialRef[] {
  const out: MaterialRef[] = [];
  for (const e of raw?.materialList ?? []) {
    const t = e.matPair?.matType;
    const i = e.matPair?.matIndex;
    if (typeof t !== "number" || typeof i !== "number") continue;
    out.push({ matType: t, matIndex: i, id: e.id, name: e.name });
  }
  return out;
}

/**
 * Derive the default scan bounds: full x/y embark, z anchored on the player's
 * current view (a ±zBand window). Falls back to the top quartile of the map
 * if ViewInfo is missing.
 *
 * Note: BlockRequest.min_x/max_x/min_y/max_y are in BLOCK coords (each block
 * is 16×16 tiles). min_z/max_z are in single z-levels. MapInfo's blockPos*
 * gives the embark origin in the same block space — for fortress mode the
 * loaded slice spans [blockPos*, blockPos* + blockSize* - 1].
 */
function defaultBounds(
  mapInfo: MapInfoOut,
  view: ViewInfoOut | undefined,
  zBand: number,
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  const bz = mapInfo.blockPosZ ?? 0;
  const sx = mapInfo.blockSizeX ?? 0;
  const sy = mapInfo.blockSizeY ?? 0;
  const sz = mapInfo.blockSizeZ ?? 0;
  // x/y in BlockRequest are embark-LOCAL block coords (0..blockSize*-1).
  // blockPosX/Y describe where the embark sits in the world but RFR's
  // BlockRequest operates within the loaded slice.
  const minX = 0;
  const maxX = sx - 1;
  const minY = 0;
  const maxY = sy - 1;
  // z is in absolute z-level space matching MapInfo's blockPosZ + blockSizeZ.
  const mapMinZ = bz;
  const mapMaxZ = bz + sz - 1;

  let centerZ: number;
  if (typeof view?.viewPosZ === "number") {
    centerZ = view.viewPosZ;
  } else {
    centerZ = bz + Math.floor((sz * 3) / 4);
  }
  const minZ = Math.max(mapMinZ, centerZ - zBand);
  const maxZ = Math.min(mapMaxZ, centerZ + zBand);
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function registerItemCensusTool(server: McpServer) {
  server.tool(
    "item_census",
    "Census of items physically present on tiles in a region. Buckets " +
      "by (itemType, material) with count + stackTotal; surfaces " +
      "decorated items (improvements[] populated — RFR's best value " +
      "proxy) as a separate list. Defaults to a z-band around the " +
      "player's current camera (view_pos_z ± z_band, default 25) so a " +
      "no-args call captures the active fort. Pass z_min/z_max to " +
      "scan elsewhere, or scan_all_z:true to sweep the whole map. " +
      "CAVEATS: RFR exposes no item quality, no per-material base " +
      "value, and no stockpile-membership linkage. Items here are " +
      "TILE PRESENCE only — they may be stockpiled, dumped, carried " +
      "by a creature, on furniture, or just loose. Cannot answer " +
      "\"what's in stockpile X\".",
    {
      z_min: z
        .number()
        .int()
        .optional()
        .describe("Lower z bound (inclusive). Default: viewPosZ - z_band."),
      z_max: z
        .number()
        .int()
        .optional()
        .describe("Upper z bound (inclusive). Default: viewPosZ + z_band."),
      z_band: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Half-width of the default z window around the camera. Default: 5 (each block carries ~80KB of payload, so wide z windows can drown the server in chunks)."),
      scan_all_z: z
        .boolean()
        .optional()
        .describe("Sweep the entire z range. Overrides z_min/z_max/z_band."),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("How many buckets to surface per ranking (default: 20)."),
      decorated_limit: z
        .number()
        .int()
        .min(0)
        .max(500)
        .optional()
        .describe("Cap on the decorated-items list (default: 50). The total decorated count is always reported in `total.decorated`."),
    },
    async ({ z_min, z_max, z_band, scan_all_z, top_n, decorated_limit }) => {
      try {
        const [mapInfo, view, itemTypesRaw, materialsRaw] = await Promise.all([
          callToolTyped<MapInfoOut>("GetMapInfo"),
          callToolTyped<ViewInfoOut>("GetViewInfo").catch(() => undefined),
          getReferenceDataset<MaterialListLike>("item_types"),
          getReferenceDataset<MaterialListLike>("materials"),
        ]);

        // RFR's GetBlockList is change-driven: blocks are only returned on
        // first sight or when their hash changes. Without a reset we'd inherit
        // whatever the "already sent" set was from prior get_block_list calls
        // and get an empty sweep. Reset to force a full snapshot for this
        // census. (Affects any other consumer that depends on diff-tracking —
        // this server has no such consumer today.)
        await callToolTyped<unknown>("ResetMapHashes");

        const band = z_band ?? 5;
        let bounds = defaultBounds(mapInfo, view, band);
        if (scan_all_z) {
          const bz = mapInfo.blockPosZ ?? 0;
          const sz = mapInfo.blockSizeZ ?? 0;
          bounds = { ...bounds, minZ: bz, maxZ: bz + sz - 1 };
        } else {
          if (typeof z_min === "number") bounds = { ...bounds, minZ: z_min };
          if (typeof z_max === "number") bounds = { ...bounds, maxZ: z_max };
        }

        const sweep = await sweepBlocks(bounds, {
          // Per-block payload is ~80KB. Keep each chunk well under the
          // server's memory comfort by capping at 64 blocks per call.
          chunkBudget: 64,
          call: (chunk) =>
            // blocks_needed caps how many blocks DFHack will send back per
            // call. Unset (or 0) means "send 0" — not "send all" — so without
            // an explicit cap every chunk returns empty.
            callToolTyped<BlockListOut>("GetBlockList", {
              ...chunk,
              blocksNeeded: 1_000_000,
            }),
        });

        const report = buildItemCensus(
          {
            blocks: sweep.mapBlocks,
            bounds,
            itemTypes: toItemTypeRefs(itemTypesRaw),
            materials: toMaterialRefs(materialsRaw),
          },
          { topN: top_n, decoratedLimit: decorated_limit },
        );

        return jsonResult({
          ...report,
          sweep: {
            chunksIssued: sweep.chunksIssued,
            chunkBudget: sweep.chunkBudget,
          },
        });
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
