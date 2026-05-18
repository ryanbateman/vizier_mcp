import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { paginate } from "../pagination.js";
import { callTool, callToolTyped, jsonResult, formatError } from "./helpers.js";
import type { ListJobSkillsOut, ListMaterialsOut } from "../dfhack/proto-types.js";

export function registerReferenceTools(server: McpServer) {
  server.tool("list_enums", "List all enum definitions used in game data (material flags, unit flags, labors, skills, professions, etc.)", {}, async () => {
    return callTool("ListEnums");
  });

  server.tool(
    "list_job_skills",
    "List all job skills, professions, and unit labors with their attributes",
    {
      type: z.enum(["skill", "profession", "labor"]).optional().describe("Return only this type (paginates). If omitted, returns all three types unpaginated."),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ type, offset, limit }) => {
      try {
        const result = await callToolTyped<ListJobSkillsOut>("ListJobSkills");
        if (type) {
          const values = result[type] ?? [];
          const page = paginate(values, offset ?? 0, limit ?? 100);
          return jsonResult(page);
        }
        return jsonResult(result);
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
      }
    }
  );

  server.tool(
    "list_materials",
    "List material definitions (stone, metal, wood, glass, etc.) with optional filters",
    {
      builtin: z.boolean().optional().describe("Include builtin materials (default: false)"),
      inorganic: z.boolean().optional().describe("Include inorganic materials like stone, metal, gem (default: false)"),
      creatures: z.boolean().optional().describe("Include creature materials like leather, bone, silk (default: false)"),
      plants: z.boolean().optional().describe("Include plant materials like wood, cloth (default: false)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ builtin, inorganic, creatures, plants, offset, limit }) => {
      try {
        const input: Record<string, unknown> = {};
        if (builtin !== undefined) input["builtin"] = builtin;
        if (inorganic !== undefined) input["inorganic"] = inorganic;
        if (creatures !== undefined) input["creatures"] = creatures;
        if (plants !== undefined) input["plants"] = plants;
        if (Object.keys(input).length === 0) {
          input["inorganic"] = true;
        }
        const result = await callToolTyped<ListMaterialsOut>("ListMaterials", input);
        const values = result.value ?? [];
        const page = paginate(values, offset ?? 0, limit ?? 100);
        return jsonResult(page);
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
      }
    }
  );

  server.tool("get_material_list", "List all material definitions in the game (stone, metal, wood, glass, etc.)", {}, async () => {
    return callTool("GetMaterialList");
  });

  server.tool("get_item_list", "List item type definitions (weapons, armor, furniture, etc.)", {}, async () => {
    return callTool("GetItemList");
  });

  server.tool("get_building_def_list", "List building type definitions (workshops, furnaces, traps, etc.)", {}, async () => {
    return callTool("GetBuildingDefList");
  });

  server.tool("get_creature_raws", "List creature raw definitions (all creature types in the game)", {}, async () => {
    return callTool("GetCreatureRaws");
  });

  server.tool("get_plant_raws", "List plant raw definitions (all plant types in the game)", {}, async () => {
    return callTool("GetPlantRaws");
  });

  server.tool("get_tiletype_list", "List all tile type definitions (wall, floor, ramp, stair types, etc.)", {}, async () => {
    return callTool("GetTiletypeList");
  });

  server.tool("get_language", "Get language and translation data used for item/unit names", {}, async () => {
    return callTool("GetLanguage");
  });
}