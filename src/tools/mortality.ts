import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callToolTyped,
  enrichUnitList,
  errorResult,
  jsonResult,
  STRUCTURED_NAME_NOTE,
} from "./helpers.js";
import { buildMortalityReport } from "../mortality.js";
import type {
  GetWorldInfoOut,
  ListUnitsOut,
  UnitBase,
} from "../dfhack/proto-types.js";

export function registerMortalityTool(server: McpServer) {
  server.tool(
    "fortress_mortality",
    "Audit of fortress losses: who is dead, where they fell, and the " +
      "decoded death-info flags. Ordered most-recent-first via DF's " +
      "deathId. Counts by race and profession for quick triage. Defaults " +
      "to the world's player race so the report shows dwarves, not the " +
      "noisy backdrop of dead wildlife — pass `race` to query other " +
      "species or `scan_all` to include every dead thing." +
      " Does NOT see who killed each unit, the manner of death (slain in " +
      "combat / starvation / murder / butchered), or the death event " +
      "narrative — those live in DF's event log and require the " +
      "RunLua-blocked surface (see UNLOCKING-LEGENDS.md). Wounds and " +
      "blood data are NOT included: RFR's GetUnitList only returns " +
      "active units, so corpses never have wound/blood data to surface." +
      STRUCTURED_NAME_NOTE,
    {
      race: z.number().optional().describe(
        "Race ID to filter dead by (default: world's player race from " +
          "GetWorldInfo). Set scan_all:true to ignore the race filter " +
          "entirely.",
      ),
      scan_all: z.boolean().optional().describe(
        "Include dead units of every race (default: false). Overrides " +
          "the race filter.",
      ),
    },
    async ({ race, scan_all }) => {
      try {
        let targetRace: number | undefined;
        if (!scan_all) {
          targetRace = race;
          if (targetRace === undefined) {
            const world = await callToolTyped<GetWorldInfoOut>("GetWorldInfo");
            targetRace = (world as GetWorldInfoOut & { raceId?: number }).raceId;
          }
        }

        const listInput: Record<string, unknown> = {
          scanAll: true,
          dead: true,
          mask: { profession: true },
        };
        if (targetRace !== undefined) listInput["race"] = targetRace;

        const coreResult = await callToolTyped<ListUnitsOut>("ListUnits", listInput);
        const dead = coreResult.value ?? [];
        await enrichUnitList(dead);

        const report = buildMortalityReport(dead as UnitBase[]);
        return jsonResult(report);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
