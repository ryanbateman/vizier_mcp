import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { callToolTyped, jsonResult, errorResult } from "./helpers.js";

const GATE_NOTE =
  " Registered only when VIZIER_ENABLE_ACTIONS=1.";

/**
 * Native game-action tools — writes that wrap a single typed DFHack RPC (no
 * Lua companion needed). Registered only when `actionsEnabled`.
 */
export function registerGameActionTools(
  server: McpServer,
  options: { actionsEnabled: boolean },
) {
  if (!options.actionsEnabled) return;

  server.tool(
    "set_pause_state",
    "Pause or unpause the game (DFHack SetPauseState). Reversible WRITE action; " +
      "read the current state with get_pause_state." +
      GATE_NOTE,
    {
      paused: z.boolean().describe("true to pause, false to unpause"),
    },
    async ({ paused }) => {
      try {
        // SingleBool's field is `Value` (capitalised) in DFHack's proto —
        // matches what get_pause_state returns.
        await callToolTyped<Record<string, unknown>>("SetPauseState", {
          Value: paused,
        });
        return jsonResult({ status: "ok", method: "SetPauseState", paused });
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
