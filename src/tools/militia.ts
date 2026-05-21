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
  /** DF stores squad members as historical figure ids, not unit ids. */
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
      "list_units (skills mask) + get_unit_list (inventory). Joined via " +
      "histfigId, not unitId — DF squads track persistent historical-figure " +
      "identity. Empty squad slots are filtered; histfigIds that no longer " +
      "match any active unit (dead/off-map/stale roster) surface as " +
      "unresolvedHistfigIds on the squad rather than as stub members." +
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

        // Two indexes from Core: by histfigId (the squad-join key) and by
        // unitId (so we can match the RFR creature for inventory).
        const coreByHistfig = new Map<number, UnitBase>();
        const coreByUnitId = new Map<number, UnitBase>();
        for (const u of coreUnits) {
          const uid = (u as { unitId?: number }).unitId;
          if (typeof uid === "number") coreByUnitId.set(uid, u);
          if (typeof u.histfigId === "number" && u.histfigId > 0) {
            coreByHistfig.set(u.histfigId, u);
          }
        }
        const rfrById = new Map<number, CreatureRaw>();
        for (const c of creatures) {
          if (typeof c.id === "number") rfrById.set(c.id, c);
        }

        const squads: SquadInput[] = (squadsResult.value ?? []).map((s) => ({
          squadId: s.squadId,
          alias: s.alias,
          name: s.name,
          memberHistfigIds: s.members ?? [],
        }));

        // Build SoldierInput entries for every dwarf the squads reference
        // *plus* every RFR-flagged isSoldier. The aggregator decides which
        // belong to which squad via histfigId.
        const interestingHistfigs = new Set<number>();
        for (const sq of squads) {
          for (const h of sq.memberHistfigIds) {
            if (h > 0) interestingHistfigs.add(h);
          }
        }

        const soldiers: SoldierInput[] = [];
        const seenUnitIds = new Set<number>();

        for (const histfigId of interestingHistfigs) {
          const core = coreByHistfig.get(histfigId);
          if (!core) continue; // unresolved — handled inside the aggregator
          const unitId = (core as { unitId?: number }).unitId;
          if (typeof unitId !== "number") continue;
          seenUnitIds.add(unitId);
          const rfr = rfrById.get(unitId);
          soldiers.push({
            unitId,
            histfigId,
            name: core.name,
            raceName: core.raceName ?? rfr?.raceName,
            professionName: core.professionName ?? rfr?.professionName,
            isSoldier: (rfr as { isSoldier?: boolean } | undefined)?.isSoldier,
            skills: (core as { skills?: SoldierInput["skills"] }).skills,
            inventory: (rfr as { inventory?: SoldierInput["inventory"] } | undefined)?.inventory,
          });
        }

        // Also include RFR-flagged isSoldier units that aren't already in a
        // squad's roster — civilian draftees / militia not yet assigned.
        for (const c of creatures) {
          if (typeof c.id !== "number") continue;
          if (seenUnitIds.has(c.id)) continue;
          if (!(c as { isSoldier?: boolean }).isSoldier) continue;
          const core = coreByUnitId.get(c.id);
          soldiers.push({
            unitId: c.id,
            histfigId: core?.histfigId,
            name: core?.name,
            raceName: core?.raceName ?? c.raceName,
            professionName: core?.professionName ?? c.professionName,
            isSoldier: true,
            skills: (core as { skills?: SoldierInput["skills"] } | undefined)?.skills,
            inventory: (c as { inventory?: SoldierInput["inventory"] }).inventory,
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
