import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTool, errorResult } from "./helpers.js";
import { blockRequestSchema } from "./schemas.js";
import { checkBlockVolume } from "../block-volume.js";

export function registerMapTools(server: McpServer) {
  server.tool(
    "get_block_list",
    "Get map tile data for a region. Returns terrain, materials, and " +
      "tile information. Only returns blocks that changed since the last " +
      "call (change-driven). " +
      "GUARD: requests whose bounding-box volume exceeds " +
      "VIZIER_MAX_BLOCK_VOLUME (default 16384) are rejected before " +
      "forwarding to DFHack — wide RFR sweeps can crash the DFHack " +
      "process and take this MCP server down with it.",
    blockRequestSchema,
    async ({ minX, minY, minZ, maxX, maxY, maxZ }) => {
      const guard = checkBlockVolume({ minX, minY, minZ, maxX, maxY, maxZ });
      if (!guard.ok) return errorResult(new Error(guard.reason));
      return callTool("GetBlockList", { minX, minY, minZ, maxX, maxY, maxZ });
    }
  );
}
