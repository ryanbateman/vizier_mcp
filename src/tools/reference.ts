import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../dfhack/client.js";

const blockRequestSchema = {
  minX: z.number().describe("Minimum X block coordinate"),
  minY: z.number().describe("Minimum Y block coordinate"),
  minZ: z.number().describe("Minimum Z (depth) block coordinate"),
  maxX: z.number().describe("Maximum X block coordinate"),
  maxY: z.number().describe("Maximum Y block coordinate"),
  maxZ: z.number().describe("Maximum Z (depth) block coordinate"),
};

export function registerReferenceTools(server: McpServer) {
  server.tool(
    "get_block_list",
    "Get map tile data for a region. Returns terrain, materials, and tile information. Note: only returns blocks that changed since the last call (change-driven).",
    blockRequestSchema,
    async ({ minX, minY, minZ, maxX, maxY, maxZ }) => {
      try {
        const client = await getClient();
        const result = await client.call("GetBlockList", { minX, minY, minZ, maxX, maxY, maxZ });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool("get_material_list", "List all material definitions in the game (stone, metal, wood, glass, etc.)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetMaterialList");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_item_list", "List item type definitions (weapons, armor, furniture, etc.)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetItemList");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_building_def_list", "List building type definitions (workshops, furnaces, traps, etc.)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetBuildingDefList");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_creature_raws", "List creature raw definitions (all creature types in the game)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetCreatureRaws");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_plant_raws", "List plant raw definitions (all plant types in the game)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetPlantRaws");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_tiletype_list", "List all tile type definitions (wall, floor, ramp, stair types, etc.)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetTiletypeList");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool("get_language", "Get language and translation data used for item/unit names", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetLanguage");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });
}