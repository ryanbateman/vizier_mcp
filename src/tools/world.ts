import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../dfhack/client.js";

export function registerWorldTools(server: McpServer) {
  server.tool("get_version_info", "Get Dwarf Fortress and DFHack version information", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetVersionInfo");
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

  server.tool("get_world_info", "Get current world information: world name, game mode, and world ID", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetWorldInfo");
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

  server.tool("get_map_info", "Get map dimensions and region information for the loaded fortress", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetMapInfo");
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

  server.tool("get_view_info", "Get current viewport position and size (what the player is looking at)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetViewInfo");
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

  server.tool("get_pause_state", "Check if the Dwarf Fortress game is currently paused", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("GetPauseState");
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