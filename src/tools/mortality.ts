import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  callToolTyped,
  enrichCreatureList,
  enrichUnitList,
  errorResult,
  jsonResult,
  STRUCTURED_NAME_NOTE,
} from "./helpers.js";
import { buildMortalityReport } from "../mortality.js";
import type {
  CreatureRaw,
  ListUnitsOut,
  UnitBase,
  UnitList,
} from "../dfhack/proto-types.js";

interface RfrCreatureExt extends CreatureRaw {
  posX?: number;
  posY?: number;
  posZ?: number;
  bloodCount?: number;
  bloodMax?: number;
  wounds?: Array<{
    parts?: Array<{
      bodyPartId?: number;
      globalLayerIdx?: number;
      layerIdx?: number;
    }>;
    severedPart?: boolean;
  }>;
}

export function registerMortalityTool(server: McpServer) {
  server.tool(
    "fortress_mortality",
    "Audit of fortress losses: who is dead, where they fell, what wounds " +
      "they carry, blood status, and the decoded death-info flags. Ordered " +
      "most-recent-first via DF's deathId. Counts by race and profession " +
      "for quick triage. Composes list_units(dead:true) (Core) with " +
      "get_unit_list (RFR) and joins by unit id for position + wounds." +
      " Does NOT see who killed each unit, the manner of death (slain in " +
      "combat / starvation / murder), or the death event narrative — " +
      "those live in DF's event log and require the RunLua-blocked " +
      "surface (see UNLOCKING-LEGENDS.md). Body-part ids in the wounds " +
      "structure are not yet resolved to names." +
      STRUCTURED_NAME_NOTE,
    {},
    async () => {
      try {
        const [coreResult, rfrResult] = await Promise.all([
          callToolTyped<ListUnitsOut>("ListUnits", {
            scanAll: true,
            dead: true,
            mask: { profession: true },
          }),
          callToolTyped<UnitList>("GetUnitList"),
        ]);

        const dead = coreResult.value ?? [];
        await enrichUnitList(dead);

        const creatures = rfrResult.creatureList ?? [];
        await enrichCreatureList(creatures);

        const rfrById = new Map<number, RfrCreatureExt>();
        for (const c of creatures) {
          if (typeof c.id === "number") rfrById.set(c.id, c as RfrCreatureExt);
        }

        const report = buildMortalityReport(dead as UnitBase[], rfrById);
        return jsonResult(report);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
