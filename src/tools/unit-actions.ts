import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, errorResult } from "./helpers.js";
import {
  callUnits,
  pingUnits,
  UNITS_SCHEMA,
  UnitsScriptMissingError,
} from "../dfhack/rpc-units.js";

const INSTALL_INSTRUCTIONS = [
  "The unit-action tools rely on a tiny Lua companion script that lives inside",
  "DFHack — these unit fields aren't writable over the typed",
  "RemoteFortressReader socket, so Vizier MCP needs this companion (the same",
  "mechanism as the legends / jobs tools).",
  "",
  "Install:",
  "  1. Copy lua/rpc/units.lua from the Vizier MCP repo to:",
  "       <DF install>/hack/lua/rpc/units.lua",
  "     (or run `npx @ryanbateman/vizier-mcp install-companion`, which",
  "     installs every bundled companion).",
  "  2. Ensure VIZIER_ENABLE_RUN_LUA=1 is set in the environment that runs",
  "     vizier-mcp, and VIZIER_ENABLE_ACTIONS=1 to register the write tools.",
  "  3. Restart Vizier MCP if it was already running, then re-run",
  "     units_setup_check to confirm.",
].join("\n");

const RUN_LUA_NOTE =
  " Requires VIZIER_ENABLE_RUN_LUA=1 and the rpc/units.lua companion module. " +
  "If the tool reports the script is missing, call units_setup_check for " +
  "install instructions.";

const GATE_NOTE =
  " Registered only when VIZIER_ENABLE_ACTIONS=1; wrapped in dfhack.with_suspend " +
  "for a consistent game state.";

function unitsError(err: unknown) {
  if (err instanceof UnitsScriptMissingError) {
    return jsonResult({
      status: "missing",
      message: err.message,
      hint: "Call units_setup_check for install instructions.",
    });
  }
  return errorResult(err);
}

/**
 * Register the unit-action tools. units_setup_check always registers (discovery
 * path); the write tools register only when `actionsEnabled`
 * (VIZIER_ENABLE_ACTIONS).
 */
export function registerUnitActionTools(
  server: McpServer,
  options: { actionsEnabled: boolean },
) {
  server.tool(
    "units_setup_check",
    "Diagnostic for the unit-action companion script. Probes whether the " +
      "rpc.units Lua module is installed and callable, and returns install " +
      "instructions if not. Call this first if a set_unit_* / teleport_unit " +
      "tool reports a missing script.",
    {},
    async () => {
      try {
        const result = await pingUnits();
        const schemaMatch = result.schema === UNITS_SCHEMA;
        return jsonResult({
          status: schemaMatch ? "ready" : "schema_mismatch",
          installedSchema: result.schema,
          expectedSchema: UNITS_SCHEMA,
          dfhackVersion: result.dfhack,
          actionsEnabled: options.actionsEnabled,
          message: schemaMatch
            ? "rpc.units companion is installed and reachable." +
              (options.actionsEnabled
                ? ""
                : " Write tools are disabled (set VIZIER_ENABLE_ACTIONS=1 to enable).")
            : `rpc.units schema ${result.schema} does not match expected ${UNITS_SCHEMA}. ` +
              `Update lua/rpc/units.lua from the latest Vizier MCP repo.`,
        });
      } catch (err) {
        if (err instanceof UnitsScriptMissingError) {
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

  if (!options.actionsEnabled) return;

  server.tool(
    "set_unit_nickname",
    "Set or clear a unit's nickname (also updates the linked historical " +
      "figure). Pass an empty string to clear. Reversible WRITE action." +
      GATE_NOTE +
      RUN_LUA_NOTE,
    {
      unit_id: z.number().int().describe("Unit id (from list_units / get_unit)"),
      nickname: z
        .string()
        .describe("New nickname; empty string clears the existing nickname"),
    },
    async ({ unit_id, nickname }) => {
      try {
        const data = await callUnits<unknown>("set_nickname", [
          String(unit_id),
          nickname,
        ]);
        return jsonResult(data);
      } catch (err) {
        return unitsError(err);
      }
    },
  );

  server.tool(
    "set_unit_custom_profession",
    "Set or clear a unit's custom profession label — the free-text role that " +
      "overrides the displayed profession (e.g. \"Lead Miner\"). Pass an empty " +
      "string to clear. Reversible WRITE action." +
      GATE_NOTE +
      RUN_LUA_NOTE,
    {
      unit_id: z.number().int().describe("Unit id (from list_units / get_unit)"),
      profession: z
        .string()
        .describe("New custom profession label; empty string clears it"),
    },
    async ({ unit_id, profession }) => {
      try {
        const data = await callUnits<unknown>("set_custom_profession", [
          String(unit_id),
          profession,
        ]);
        return jsonResult(data);
      } catch (err) {
        return unitsError(err);
      }
    },
  );

  server.tool(
    "teleport_unit",
    "Relocate a unit to a map coordinate (dfhack.units.teleport). Returns the " +
      "unit's position after the move. Capture the prior pos via get_unit first " +
      "if you want to move it back." +
      GATE_NOTE +
      RUN_LUA_NOTE,
    {
      unit_id: z.number().int().describe("Unit id (from list_units / get_unit)"),
      x: z.number().int().describe("Target tile X"),
      y: z.number().int().describe("Target tile Y"),
      z: z.number().int().describe("Target tile Z (z-level)"),
    },
    async ({ unit_id, x, y, z }) => {
      try {
        const data = await callUnits<unknown>("teleport_unit", [
          String(unit_id),
          String(x),
          String(y),
          String(z),
        ]);
        return jsonResult(data);
      } catch (err) {
        return unitsError(err);
      }
    },
  );
}
