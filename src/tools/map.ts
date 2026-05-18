import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTool } from "./helpers.js";
import { blockRequestSchema } from "./schemas.js";

export function registerMapTools(server: McpServer) {
  server.tool(
    "get_block_list",
    "Get map tile data for a region. Returns terrain, materials, and tile information. Note: only returns blocks that changed since the last call (change-driven).",
    blockRequestSchema,
    async ({ minX, minY, minZ, maxX, maxY, maxZ }) => {
      return callTool("GetBlockList", { minX, minY, minZ, maxX, maxY, maxZ });
    }
  );
}
