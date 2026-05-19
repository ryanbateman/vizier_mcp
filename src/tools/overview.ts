import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callToolTyped,
  enrichUnitList,
  jsonResult,
  errorResult,
} from "./helpers.js";
import { ensureLookups } from "../lookup-cache.js";
import { buildFortressOverview, type MapInfoLike } from "../overview.js";
import type {
  GetWorldInfoOut,
  ListUnitsOut,
  UnitBase,
} from "../dfhack/proto-types.js";

export function registerOverviewTools(server: McpServer) {
  server.tool(
    "get_fortress_overview",
    "One-call summary of the current world, map, and dwarf population. " +
      "Returns world (name, save, mode, civ/site/race resolved), map (embark " +
      "size in tiles + z-levels), and population (total, profession histogram, " +
      "gender split, top-N notable skills L>=5). Bounded, small payload — use " +
      "this before drilling into list_units / get_unit. Honors the same " +
      "RunLua-blocked data boundary as the rest of the server (no jobs, mood, " +
      "stress, legends, relationships).",
    {
      race: z.number().optional().describe(
        "Race ID to count (default: world's player race from GetWorldInfo)",
      ),
      notable_min_level: z.number().int().min(0).optional().describe(
        "Minimum skill level to list under notable (default: 5)",
      ),
      notable_limit: z.number().int().min(1).max(200).optional().describe(
        "Max notable-skill entries (default: 25)",
      ),
    },
    async ({ race, notable_min_level, notable_limit }) => {
      try {
        const [world, mapInfo] = await Promise.all([
          callToolTyped<GetWorldInfoOut>("GetWorldInfo"),
          callToolTyped<MapInfoLike>("GetMapInfo"),
        ]);
        const targetRace = race ?? (world as GetWorldInfoOut & { raceId?: number }).raceId;
        const listInput: Record<string, unknown> = {
          scanAll: true,
          // The aggregator needs profession and skills to build the histogram
          // and notable-skills list; without the mask, ListUnits leaves both
          // fields off and everyone gets bucketed under "(unknown)".
          mask: { profession: true, skills: true },
        };
        if (targetRace !== undefined) listInput["race"] = targetRace;
        const unitsResult = await callToolTyped<ListUnitsOut>("ListUnits", listInput);
        const units: UnitBase[] = unitsResult.value ?? [];
        await enrichUnitList(units);
        const lookups = await ensureLookups();
        const overview = buildFortressOverview(world, mapInfo, units, lookups, {
          notableMinLevel: notable_min_level,
          notableLimit: notable_limit,
        });
        return jsonResult(overview);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
