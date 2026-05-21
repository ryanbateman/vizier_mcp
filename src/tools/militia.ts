import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callToolTyped,
  enrichCreatureList,
  enrichUnitList,
  errorResult,
  jsonResult,
  STRUCTURED_NAME_NOTE,
} from "./helpers.js";
import { buildMilitiaReport, type SoldierInput, type SquadInput } from "../militia.js";
import type {
  CreatureRaw,
  ListUnitsOut,
  ResolvedName,
  UnitBase,
  UnitList,
} from "../dfhack/proto-types.js";

interface BasicSquadInfo {
  squadId: number;
  alias?: string;
  name?: ResolvedName;
  members?: number[];
}

interface ListSquadsOut {
  value?: BasicSquadInfo[];
}

export function registerMilitiaTool(server: McpServer) {
  server.tool(
    "assess_militia",
    "Squad-by-squad readiness audit: who is in each squad, what combat " +
      "skills they have trained, what they're armed with, and where they " +
      "are missing armour. Also lists any unit flagged isSoldier:true who " +
      "isn't in a squad (draftees, civilian militia). Per-soldier output " +
      "names the worst-equipped first so the report surfaces the dwarves " +
      "marching to their deaths in a dress. Composes list_squads + " +
      "list_units (skills mask) + get_unit_list (inventory) and joins " +
      "by unit id." +
      " Does NOT see current job (sparring vs patrolling vs idle), squad " +
      "training schedule, or kill counts — those are RunLua-blocked." +
      STRUCTURED_NAME_NOTE,
    {
      trained_threshold: z.number().int().min(0).optional().describe(
        "A soldier counts as 'trained' if their top combat or weapon skill " +
          "is at least this level (default: 5).",
      ),
    },
    async ({ trained_threshold }) => {
      try {
        // Pull the three sides in parallel — they're independent RPCs.
        const [squadsResult, coreResult, rfrResult] = await Promise.all([
          callToolTyped<ListSquadsOut>("ListSquads"),
          callToolTyped<ListUnitsOut>("ListUnits", {
            scanAll: true,
            mask: { profession: true, skills: true },
          }),
          callToolTyped<UnitList>("GetUnitList"),
        ]);

        const coreUnits = coreResult.value ?? [];
        await enrichUnitList(coreUnits);
        const creatures = rfrResult.creatureList ?? [];
        await enrichCreatureList(creatures);

        // Index core units by id (preferred source for structured name +
        // skills + profession) and RFR creatures by id (source for inventory
        // and the isSoldier flag).
        const coreById = new Map<number, UnitBase>();
        for (const u of coreUnits) {
          const uid = (u as { unitId?: number }).unitId;
          if (typeof uid === "number") coreById.set(uid, u);
        }
        const rfrById = new Map<number, CreatureRaw>();
        for (const c of creatures) {
          if (typeof c.id === "number") rfrById.set(c.id, c);
        }

        // Soldiers we care about: any unit that's in a squad, plus any RFR
        // creature flagged isSoldier (covers civilian militia / draftees
        // not yet bound to a squad).
        const inSquads = new Set<number>();
        const squads: SquadInput[] = (squadsResult.value ?? []).map((s) => {
          const members = s.members ?? [];
          for (const m of members) inSquads.add(m);
          return {
            squadId: s.squadId,
            alias: s.alias,
            name: s.name,
            memberIds: members,
          };
        });

        const wantedIds = new Set<number>(inSquads);
        for (const c of creatures) {
          if (typeof c.id === "number" && (c as { isSoldier?: boolean }).isSoldier) {
            wantedIds.add(c.id);
          }
        }

        const soldiers: SoldierInput[] = [];
        for (const id of wantedIds) {
          const core = coreById.get(id);
          const rfr = rfrById.get(id);
          // Prefer the structured name from Core; fall back to nothing (the
          // aggregator handles undefined names cleanly).
          soldiers.push({
            unitId: id,
            name: core?.name,
            professionName: core?.professionName ?? rfr?.professionName,
            isSoldier: (rfr as { isSoldier?: boolean } | undefined)?.isSoldier,
            skills: (core as { skills?: SoldierInput["skills"] } | undefined)?.skills,
            inventory: (rfr as { inventory?: SoldierInput["inventory"] } | undefined)?.inventory,
          });
        }

        const report = buildMilitiaReport(squads, soldiers, {
          trainedThreshold: trained_threshold,
        });
        return jsonResult(report);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
