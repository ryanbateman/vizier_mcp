import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTool, errorResult } from "./helpers.js";
import { blockRequestSchema } from "./schemas.js";
import { checkBlockVolume } from "../block-volume.js";

export function registerMapTools(server: McpServer) {
  server.tool(
    "get_block_list",
    "Get map tile data for a region (BLOCK coords for x/y, z-level for z; " +
      "each block = 16×16 tiles). Returns terrain, materials, items, etc. " +
      "Change-driven: only returns blocks that changed since the last " +
      "call. `blocks_needed` caps how many blocks the server will return " +
      "per call — unset/0 means SEND ZERO, not unlimited; pass a generous " +
      "number to actually get data back. " +
      "GUARD: requests whose bounding-box volume exceeds " +
      "VIZIER_MAX_BLOCK_VOLUME (default 16384) are rejected before " +
      "forwarding to DFHack — wide RFR sweeps can crash the DFHack " +
      "process and take this MCP server down with it.",
    {
      ...blockRequestSchema,
      blocks_needed: z.number().int().min(0).optional().describe(
        "Cap on blocks returned. 0/unset means 0 — pass e.g. 1000000 to get all matching blocks.",
      ),
    },
    async ({ minX, minY, minZ, maxX, maxY, maxZ, blocks_needed }) => {
      const guard = checkBlockVolume({ minX, minY, minZ, maxX, maxY, maxZ });
      if (!guard.ok) return errorResult(new Error(guard.reason));
      const input: Record<string, unknown> = {
        minX, minY, minZ, maxX, maxY, maxZ,
      };
      if (blocks_needed !== undefined) input["blocksNeeded"] = blocks_needed;
      return callTool("GetBlockList", input);
    }
  );
}
