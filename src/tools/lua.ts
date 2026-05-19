import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callTool, errorResult } from "./helpers.js";

/**
 * Mirrors DFHack's RunLua module-name gate (RemoteTools.cpp): a call is only
 * permitted for modules whose name matches `rpc.*`, `*.rpc`, or `*-rpc`
 * (with length > 4). Built-in modules like `dfhack.units` are rejected.
 */
export function isValidRpcModule(module: string): boolean {
  return (
    module.length > 4 &&
    (module.startsWith("rpc.") ||
      module.endsWith(".rpc") ||
      module.endsWith("-rpc"))
  );
}

const RUN_LUA_CONSTRAINT =
  'run_lua only works with a user-authored DFHack Lua module whose name ' +
  'matches "rpc.*", "*.rpc", or "*-rpc" (e.g. a script at ' +
  'hack/scripts/rpc/mymodule.lua, called with module "rpc.mymodule"). ' +
  "Built-in modules and arbitrary game state (df.global, dfhack.units, " +
  "dfhack.maps, …) are NOT accessible through this server — use the other " +
  "vizier tools for game data. Do not retry this with a non-rpc module.";

export function registerLuaTool(server: McpServer) {
  server.tool(
    "run_lua",
    "Call a function in a custom DFHack Lua RPC module. " +
      RUN_LUA_CONSTRAINT +
      " Localhost-only. This is NOT a general escape hatch for reading game state.",
    {
      module: z
        .string()
        .describe(
          'Name of a custom DFHack Lua module matching "rpc.*" / "*.rpc" / ' +
            '"*-rpc" (e.g. "rpc.mymodule"). Built-ins like "dfhack.units" are rejected.',
        ),
      "function": z.string().describe("Function name to call within that module"),
      arguments: z.array(z.string()).describe("Arguments to pass (as strings)"),
    },
    async ({ module: mod, "function": fn, arguments: args }) => {
      if (!isValidRpcModule(mod)) {
        return errorResult(new Error(`Invalid module "${mod}". ${RUN_LUA_CONSTRAINT}`));
      }
      return callTool("RunLua", {
        module: mod,
        function: fn,
        arguments: args,
      });
    },
  );
}
