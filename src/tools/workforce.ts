import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callToolTyped,
  enrichUnitList,
  errorResult,
  jsonResult,
} from "./helpers.js";
import { buildWorkforceReport } from "../workforce.js";
import type {
  GetWorldInfoOut,
  ListUnitsOut,
  UnitBase,
} from "../dfhack/proto-types.js";

export function registerWorkforceTool(server: McpServer) {
  server.tool(
    "workforce_report",
    "Full workforce diagnostic: profession histogram, profession/skill " +
      "mismatches (top skill is not the canonical skill of their assigned " +
      "profession), underused legends (legendary skill outside the canonical " +
      "role), idle generalists (no skill at or above the threshold), and " +
      "the single best practitioner per skill. Defaults to the world's " +
      "player race. Does NOT see current job, mood/stress, or relationships.",
    {
      race: z.number().optional().describe(
        "Race ID to survey (default: world's player race from GetWorldInfo)",
      ),
      idle_threshold: z.number().int().min(0).optional().describe(
        "A unit is 'idle generalist' if no skill reaches this level (default: 5)",
      ),
      legend_threshold: z.number().int().min(0).optional().describe(
        "Skill level that counts as 'legendary' (default: 15)",
      ),
      mismatch_delta: z.number().int().min(0).optional().describe(
        "Top skill must beat the canonical aligned skill by at least this " +
          "many levels to count as a mismatch (default: 3)",
      ),
    },
    async ({ race, idle_threshold, legend_threshold, mismatch_delta }) => {
      try {
        let targetRace = race;
        if (targetRace === undefined) {
          const world = await callToolTyped<GetWorldInfoOut>("GetWorldInfo");
          targetRace = (world as GetWorldInfoOut & { raceId?: number }).raceId;
        }
        const listInput: Record<string, unknown> = {
          scanAll: true,
          mask: { profession: true, skills: true },
        };
        if (targetRace !== undefined) listInput["race"] = targetRace;
        const result = await callToolTyped<ListUnitsOut>("ListUnits", listInput);
        const units: UnitBase[] = result.value ?? [];
        await enrichUnitList(units);
        const report = buildWorkforceReport(units, {
          idleThreshold: idle_threshold,
          legendThreshold: legend_threshold,
          mismatchDelta: mismatch_delta,
        });
        return jsonResult(report);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
