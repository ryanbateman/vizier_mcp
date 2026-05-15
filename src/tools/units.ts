import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../dfhack/client.js";

const blockRequestSchema = {
  minX: z.number().describe("Minimum X tile coordinate"),
  minY: z.number().describe("Minimum Y tile coordinate"),
  minZ: z.number().describe("Minimum Z (depth) tile coordinate"),
  maxX: z.number().describe("Maximum X tile coordinate"),
  maxY: z.number().describe("Maximum Y tile coordinate"),
  maxZ: z.number().describe("Maximum Z (depth) tile coordinate"),
};

export function registerUnitTools(server: McpServer) {
  server.tool("get_unit_list", "List all units in the fortress: dwarves, animals, invaders, etc. Returns names, positions, races, and skills. Note: response can be large for big fortresses.", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetUnitList");
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

  server.tool(
    "get_unit_list_inside",
    "List units within a specific map region (bounding box). Returns units whose positions fall within the specified coordinates.",
    blockRequestSchema,
    async ({ minX, minY, minZ, maxX, maxY, maxZ }) => {
      try {
        const client = await getClient();
        const result = await client.call("GetUnitListInside", { minX, minY, minZ, maxX, maxY, maxZ });
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
}