import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTool, formatError } from "./helpers.js";

export function registerLuaTool(server: McpServer) {
  server.tool(
    "run_lua",
    "Execute a Lua function in DFHack. Use this to query arbitrary game state not exposed by other tools (e.g., df.global, dfhack.units, dfhack.maps). WARNING: can theoretically mutate game state - use with caution.",
    {
      module: z.string().describe("Lua module name (e.g., 'utils', 'dfhack.units') or empty string for global scope"),
      "function": z.string().describe("Lua function name to call"),
      arguments: z.array(z.string()).describe("Arguments to pass to the Lua function (as strings)"),
    },
    async ({ module: mod, "function": fn, arguments: args }) => {
      return callTool("RunLua", {
        module: mod,
        function: fn,
        arguments: args,
      });
    }
  );
}