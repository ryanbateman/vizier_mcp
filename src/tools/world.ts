import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTool } from "./helpers.js";

export function registerWorldTools(server: McpServer) {
  server.tool("get_world_info", "Get current world information: world name, game mode, and world ID", {}, async () => {
    return callTool("GetWorldInfo");
  });

  server.tool("get_map_info", "Get map dimensions and region information for the loaded fortress", {}, async () => {
    return callTool("GetMapInfo");
  });

  server.tool("get_view_info", "Get current viewport position and size (what the player is looking at)", {}, async () => {
    return callTool("GetViewInfo");
  });

  server.tool("get_pause_state", "Check if the Dwarf Fortress game is currently paused", {}, async () => {
    return callTool("GetPauseState");
  });
}
