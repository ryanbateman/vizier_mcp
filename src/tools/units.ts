import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTool, callToolTyped, jsonResult, formatError, enrichCreatureList, enrichUnitList } from "./helpers.js";
import { paginate } from "../pagination.js";
import { blockRequestSchema } from "./schemas.js";
import type { ListUnitsOut, UnitList, UnitBase } from "../dfhack/proto-types.js";

export function registerUnitTools(server: McpServer) {
  server.tool(
    "list_units",
    "List units in the fortress with optional filters. Returns names, positions, races, skills. Note: response can be large for big fortresses.",
    {
      scan_all: z.boolean().optional().describe("Scan all active and killed units (default: false)"),
      race: z.number().optional().describe("Filter by race ID (e.g., 572 for dwarves)"),
      civ_id: z.number().optional().describe("Filter by civilization ID"),
      dead: z.boolean().optional().describe("Filter to dead units only"),
      alive: z.boolean().optional().describe("Filter to alive units only"),
      sane: z.boolean().optional().describe("Filter to sane units only (not dead, ghost, zombie, or insane)"),
      mask: z.object({
        profession: z.boolean().optional().describe("Include profession, custom profession, and squad assignment data"),
        skills: z.boolean().optional().describe("Include skill levels and experience for each unit"),
        labors: z.boolean().optional().describe("Include enabled labors for each unit"),
        miscTraits: z.boolean().optional().describe("Include misc traits data for each unit"),
      }).optional().describe("Data mask controlling which additional unit fields are returned"),
      name: z.string().optional().describe("Filter units by name (substring match, case-insensitive, matches first/last/english/nickname)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ scan_all, race, civ_id, dead, alive, sane, mask, name, offset, limit }) => {
      try {
        const input: Record<string, unknown> = {};
        if (race !== undefined) input["race"] = race;
        if (civ_id !== undefined) input["civId"] = civ_id;
        if (dead !== undefined) input["dead"] = dead;
        if (alive !== undefined) input["alive"] = alive;
        if (sane !== undefined) input["sane"] = sane;
        if (mask !== undefined) input["mask"] = mask;
        if (scan_all !== undefined) {
          input["scanAll"] = scan_all;
        } else if (Object.keys(input).length > 0) {
          input["scanAll"] = true;
        }
        const result = await callToolTyped<ListUnitsOut>("ListUnits", input);
        let values: UnitBase[] = result.value ?? [];
        if (name && name.trim()) {
          const lower = name.toLowerCase();
          values = values.filter((u) => {
            const n = u.name;
            return (n?.firstName?.toLowerCase().includes(lower) ||
                    n?.lastName?.toLowerCase().includes(lower) ||
                    n?.englishName?.toLowerCase().includes(lower) ||
                    n?.nickname?.toLowerCase().includes(lower));
          });
        }
        await enrichUnitList(values);
        const page = paginate(values, offset ?? 0, limit ?? 100);
        return jsonResult(page);
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
      }
    }
  );

  server.tool("list_squads", "List all military squads and their members", {}, async () => {
    return callTool("ListSquads");
  });

  server.tool(
    "set_unit_labors",
    "Set labor assignments for units by unit ID and labor ID",
    {
      changes: z.array(z.object({
        unit_id: z.number().describe("Unit ID to modify"),
        labor: z.number().describe("Labor ID (from list_enums)"),
        value: z.boolean().describe("Enable or disable the labor"),
      })).describe("List of labor changes to apply"),
    },
    async ({ changes }) => {
      try {
        await callToolTyped<Record<string, unknown>>("SetUnitLabors", {
          change: changes.map((c) => ({
            unitId: c.unit_id,
            labor: c.labor,
            value: c.value,
          })),
        });
        return jsonResult({ status: "ok", method: "SetUnitLabors", changes: changes.length });
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
      }
    }
  );

  server.tool("get_unit_list", "List all units in the fortress: dwarves, animals, invaders, etc. Returns names, positions, races, and skills. Note: response can be large for big fortresses.", {}, async () => {
    try {
      const result = await callToolTyped<UnitList>("GetUnitList");
      await enrichCreatureList(result.creatureList ?? []);
      return jsonResult(result);
    } catch (err: unknown) {
      return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
    }
  });

  server.tool(
    "get_unit_list_inside",
    "List units within a specific map region (bounding box). Returns units whose positions fall within the specified coordinates.",
    blockRequestSchema,
    async ({ minX, minY, minZ, maxX, maxY, maxZ }) => {
      try {
        const result = await callToolTyped<UnitList>("GetUnitListInside", { minX, minY, minZ, maxX, maxY, maxZ });
        await enrichCreatureList(result.creatureList ?? []);
        return jsonResult(result);
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
      }
    }
  );
}