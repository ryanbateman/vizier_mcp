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
import { buildUnitDescription } from "../describe-unit.js";
import type {
  CreatureRaw,
  ListUnitsOut,
  UnitBase,
  UnitList,
} from "../dfhack/proto-types.js";

function searchString(name: CreatureRaw["name"] | UnitBase["name"]): string {
  if (!name) return "";
  if (typeof name === "string") return name.toLowerCase();
  const n = name as {
    firstName?: string;
    lastName?: string;
    englishName?: string;
    nickname?: string;
  };
  return [n.firstName, n.lastName, n.englishName, n.nickname]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function registerDescribeUnitTool(server: McpServer) {
  server.tool(
    "describe_unit",
    "Narrative-ready single-unit report: identity, age, profession, " +
      "noble positions, top skills + counts, enabled labors, body size, " +
      "blood level, wounds (structural), and full inventory with material+ " +
      "item names resolved. One call instead of get_unit + list_units. " +
      "Does NOT see current job, mood/stress/personality, relationships, " +
      "or memories (the RunLua-blocked surface — see README appendix)." +
      STRUCTURED_NAME_NOTE,
    {
      id: z.number().int().optional().describe("Unit ID (exact match)"),
      name: z.string().optional().describe(
        "Unit name (substring, case-insensitive). Used when id is not given.",
      ),
      top_skills: z.number().int().min(1).max(40).optional().describe(
        "How many top skills to surface (default: 10)",
      ),
    },
    async ({ id, name, top_skills }) => {
      try {
        if (id === undefined && (!name || !name.trim())) {
          return errorResult(new Error("Provide either 'id' or 'name'"));
        }

        // RFR side — rich shape (inventory, wounds, age, noble_positions).
        const rfrResult = await callToolTyped<UnitList>("GetUnitList");
        const creatures = rfrResult.creatureList ?? [];
        let rfrMatches: CreatureRaw[];
        if (id !== undefined) {
          rfrMatches = creatures.filter((c) => c.id === id);
        } else {
          const lower = name!.toLowerCase();
          rfrMatches = creatures.filter((c) =>
            searchString(c.name).includes(lower),
          );
        }
        await enrichCreatureList(rfrMatches);

        // Core side — profession + skills + labors (with names resolved).
        const coreResult = await callToolTyped<ListUnitsOut>("ListUnits", {
          scanAll: true,
          mask: { profession: true, skills: true, labors: true },
        });
        const coreUnits = coreResult.value ?? [];
        await enrichUnitList(coreUnits);

        // Join the two sides by id. unitId/profession_id naming differs.
        const coreById = new Map<number, UnitBase>();
        for (const u of coreUnits) {
          const uid = (u as { unitId?: number }).unitId;
          if (typeof uid === "number") coreById.set(uid, u);
        }

        const target = rfrMatches[0];
        if (!target) {
          return jsonResult({ matched: 0, units: [] });
        }
        const core = typeof target.id === "number"
          ? coreById.get(target.id)
          : undefined;

        const description = buildUnitDescription(
          target as Parameters<typeof buildUnitDescription>[0],
          core,
          { topSkills: top_skills },
        );

        return jsonResult({
          matched: rfrMatches.length,
          unit: description,
          // If more than one RFR match, mention the rest so callers can
          // disambiguate by id without re-querying. Use the structured name
          // from the core join so disambiguation matches what the DF UI shows.
          ...(rfrMatches.length > 1
            ? {
                otherMatches: rfrMatches.slice(1).map((m) => {
                  const c = typeof m.id === "number"
                    ? coreById.get(m.id)
                    : undefined;
                  return {
                    id: m.id,
                    name: c?.name
                      ? { ...c.name }
                      : typeof m.name === "string"
                        ? { englishName: m.name }
                        : undefined,
                  };
                }),
              }
            : {}),
        });
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
