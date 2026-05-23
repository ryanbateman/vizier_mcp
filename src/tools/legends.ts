import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "./helpers.js";
import {
  callLegends,
  pingLegends,
  ScriptMissingError,
  LegendsError,
  LEGENDS_SCHEMA,
} from "../dfhack/rpc-legends.js";

const INSTALL_INSTRUCTIONS = [
  "The legends tools rely on a tiny Lua companion script that lives inside",
  "DFHack — Vizier MCP cannot reach the legends data otherwise (see",
  "UNLOCKING-LEGENDS.md in the repo for why).",
  "",
  "Install:",
  "  1. Copy lua/rpc/legends.lua from the Vizier MCP repo to:",
  "       <DF install>/hack/lua/rpc/legends.lua",
  "  2. Ensure VIZIER_ENABLE_RUN_LUA=1 is set in the environment that runs",
  "     vizier-mcp (the run_lua tool must be registered).",
  "  3. Restart Vizier MCP if it was already running.",
  "  4. Re-run legends_setup_check to confirm.",
].join("\n");

const RUN_LUA_NOTE =
  "Requires VIZIER_ENABLE_RUN_LUA=1 and the rpc/legends.lua companion " +
  "module. If the tool reports the script is missing, call " +
  "legends_setup_check for install instructions.";

export function registerLegendsTools(server: McpServer) {
  server.tool(
    "legends_setup_check",
    "Diagnostic for the legends-access companion script. Probes whether " +
      "the rpc.legends Lua module is installed and callable, and returns " +
      "install instructions if not. Call this first if any other legends_* " +
      "tool reports a missing script.",
    {},
    async () => {
      try {
        const result = await pingLegends();
        const schemaMatch = result.schema === LEGENDS_SCHEMA;
        return jsonResult({
          status: schemaMatch ? "ready" : "schema_mismatch",
          installedSchema: result.schema,
          expectedSchema: LEGENDS_SCHEMA,
          dfhackVersion: result.dfhack,
          message: schemaMatch
            ? "rpc.legends companion is installed and reachable."
            : `rpc.legends schema ${result.schema} does not match expected ${LEGENDS_SCHEMA}. ` +
              `Update lua/rpc/legends.lua from the latest Vizier MCP repo.`,
        });
      } catch (err) {
        if (err instanceof ScriptMissingError) {
          return jsonResult({
            status: "missing",
            message: err.message,
            installInstructions: INSTALL_INSTRUCTIONS,
          });
        }
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_legends_overview",
    "Narrative overview of the world's history: counts of historical " +
      "figures, events, sites, artifacts, written contents, and " +
      "entities, plus the recorded year range and the current year. " +
      "Cheap to call — reads top-level lengths only. The legends " +
      "counterpart of get_fortress_overview. " +
      RUN_LUA_NOTE,
    {},
    async () => {
      try {
        const data = await callLegends<unknown>("get_overview");
        return jsonResult(data);
      } catch (err) {
        return missingOrError(err);
      }
    },
  );

  server.tool(
    "describe_historical_figure",
    "Detailed record of a historical figure by id: identity, race, " +
      "birth/death years, entity affiliations, relationships, current " +
      "site. Returned ids cross-reference other legends collections " +
      "(entityLinks.entityId → entity, relationships.targetId → another " +
      "historical figure). " +
      RUN_LUA_NOTE,
    {
      id: z
        .number()
        .int()
        .describe(
          "Historical figure id. Look these up via get_legends_overview " +
            "(or future legends_search tool) — there is no name search yet.",
        ),
    },
    async ({ id }) => {
      try {
        const data = await callLegends<unknown>(
          "describe_historical_figure",
          [String(id)],
        );
        return jsonResult(data);
      } catch (err) {
        return missingOrError(err);
      }
    },
  );
}

/**
 * Per-tool error mapper: surface ScriptMissingError as a structured hint
 * pointing at legends_setup_check; surface LegendsError as a plain error;
 * everything else bubbles up as a tool failure.
 */
function missingOrError(err: unknown) {
  if (err instanceof ScriptMissingError) {
    return jsonResult({
      status: "missing",
      message: err.message,
      hint: "Call legends_setup_check for install instructions.",
    });
  }
  if (err instanceof LegendsError) {
    return errorResult(err);
  }
  return errorResult(err);
}
