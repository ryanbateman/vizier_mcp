import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult, STRUCTURED_NAME_NOTE } from "./helpers.js";
import {
  callLegends,
  pingLegends,
  ScriptMissingError,
  LegendsError,
  LEGENDS_SCHEMA,
} from "../dfhack/rpc-legends.js";
import { ensureLookups } from "../lookup-cache.js";

/**
 * Resolve bare integer ids in identity (race, currentProfession) and
 * preferences (creatureId, matType+matIndex, itemType+itemSubtype) to
 * names via the existing TS-side lookup cache. Mutates in place;
 * silent if the bio is malformed or the cache is unavailable.
 */
async function enrichBiography(bio: unknown): Promise<void> {
  if (!bio || typeof bio !== "object") return;
  try {
    const lookups = await ensureLookups();
    const identity = (bio as { identity?: Record<string, unknown> }).identity;
    if (identity && typeof identity === "object") {
      const race = identity.race;
      if (typeof race === "number" && lookups.creature) {
        const name = lookups.creature.get(race);
        if (name) identity.raceName = name;
      }
      const prof = identity.currentProfession;
      if (typeof prof === "number") {
        const def = lookups.profession.get(prof);
        if (def) identity.currentProfessionName = def.caption;
      }
      const sex = identity.sex;
      if (sex === 0) identity.sexName = "Female";
      else if (sex === 1) identity.sexName = "Male";
    }
    const inner = (bio as { innerLife?: { preferences?: unknown } }).innerLife;
    const prefs = inner?.preferences;
    if (Array.isArray(prefs)) {
      for (const raw of prefs) {
        const p = raw as Record<string, unknown>;
        const creatureId = p.creatureId;
        if (typeof creatureId === "number" && lookups.creature) {
          const n = lookups.creature.get(creatureId);
          if (n) p.creatureName = n;
        }
        const matType = p.matType;
        const matIndex = p.matIndex;
        if (typeof matType === "number" && typeof matIndex === "number") {
          const n = lookups.material.get(`${matType}/${matIndex}`);
          if (n) p.materialName = n;
        }
        const itemType = p.itemType;
        const itemSubtype = p.itemSubtype;
        if (typeof itemType === "number" && typeof itemSubtype === "number") {
          const n = lookups.itemType.get(`${itemType}/${itemSubtype}`);
          if (n) p.itemTypeName = n;
        }
      }
    }
    // backstory.kills.killedRaceCounts: { "<raceId>": count } -> resolve
    // race ids alongside as a parallel { "<raceName>": count } map.
    const backstory = (bio as { backstory?: { kills?: { killedRaceCounts?: unknown } } }).backstory;
    const counts = backstory?.kills?.killedRaceCounts;
    if (counts && typeof counts === "object" && lookups.creature) {
      const named: Record<string, number> = {};
      for (const [rid, count] of Object.entries(counts)) {
        const n = lookups.creature.get(Number(rid));
        if (n && typeof count === "number") named[n] = count;
      }
      if (Object.keys(named).length > 0) {
        (backstory!.kills as Record<string, unknown>).killedRaceNames = named;
      }
    }
  } catch {
    // best-effort enrichment; bare ids remain in the response
  }
}

/**
 * Resolve `race` ids to `raceName` across every category entry returned
 * by living_legends. Mutates in place; silent on any malformed input.
 */
async function enrichLivingLegends(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  try {
    const lookups = await ensureLookups();
    if (!lookups.creature) return;
    const creature = lookups.creature;
    const root = payload as Record<string, unknown>;
    const categories = [
      "civLeaders",
      "artifactCreators",
      "megabeasts",
      "semimegabeasts",
      "forgottenBeasts",
      "nightCreatures",
      "demons",
      "titans",
      "necromancers",
      "cursedFigures",
      "heroes",
    ];
    for (const cat of categories) {
      const list = root[cat];
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const entry = raw as Record<string, unknown>;
        const race = entry.race;
        if (typeof race === "number") {
          const name = creature.get(race);
          if (name) entry.raceName = name;
        }
      }
    }
  } catch {
    // best-effort enrichment; bare race ids remain in the response
  }
}

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

  server.tool(
    "dwarf_biography",
    "Full narrative biography of a dwarf (or any historical figure): " +
      "identity, origins (birth year/site, parents, civ of origin), " +
      "tenure in the fort, INNER LIFE (stress, personality traits, " +
      "beliefs and values, deity, goals — RFR-blocked surface only " +
      "reachable via the rpc.legends companion), immediate family + " +
      "social links, career-event highlights, and a list of artifacts " +
      "they crafted. Accept name (substring, case-insensitive), unit_id " +
      "(active fortress unit), or histfig_id (any historical figure in " +
      "the world). Name matching surfaces multiple hits if ambiguous — " +
      "use one of the ids from that list to disambiguate." +
      STRUCTURED_NAME_NOTE +
      " " +
      RUN_LUA_NOTE,
    {
      name: z
        .string()
        .optional()
        .describe(
          "Name substring (case-insensitive). Searches firstName and translated name.",
        ),
      unit_id: z
        .number()
        .int()
        .optional()
        .describe("Active fortress unit id."),
      histfig_id: z
        .number()
        .int()
        .optional()
        .describe(
          "Historical figure id (looked up directly, no translation needed).",
        ),
    },
    async ({ name, unit_id, histfig_id }) => {
      try {
        let hfid: number | undefined = histfig_id;

        if (hfid === undefined && unit_id !== undefined) {
          const translate = await callLegends<{
            histfigId: number | null;
            isHistoricalFigure: boolean;
          }>("find_histfig_by_unit_id", [String(unit_id)]);
          if (!translate.isHistoricalFigure || translate.histfigId == null) {
            return jsonResult({
              status: "not_a_historical_figure",
              unitId: unit_id,
              message:
                "This unit is not tracked as a historical figure (most " +
                "wildlife and pets fall into this category). Biographies " +
                "require a histfig id.",
            });
          }
          hfid = translate.histfigId;
        }

        if (hfid === undefined && name) {
          const search = await callLegends<{
            matches: Array<{
              id: number;
              firstName?: string;
              translatedName?: string;
            }>;
            total: number;
          }>("find_histfig_by_name", [name, "10"]);
          if (search.matches.length === 0) {
            return jsonResult({
              status: "no_match",
              needle: name,
              message:
                "No historical figure matched that name. Try a different " +
                "substring or pass histfig_id directly.",
            });
          }
          if (search.matches.length > 1) {
            return jsonResult({
              status: "ambiguous",
              needle: name,
              candidates: search.matches,
              message:
                `${search.matches.length} matches — call dwarf_biography again ` +
                `with histfig_id set to the right one.`,
            });
          }
          hfid = search.matches[0]!.id;
        }

        if (hfid === undefined) {
          return errorResult(
            new Error(
              "Must pass one of: name, unit_id, or histfig_id.",
            ),
          );
        }

        const bio = await callLegends<unknown>("get_biography", [String(hfid)]);
        await enrichBiography(bio);
        return jsonResult(bio);
      } catch (err) {
        return missingOrError(err);
      }
    },
  );

  server.tool(
    "living_legends",
    "World-scale digest of prominent historical figures, classified by " +
      "why they matter. Categories: civLeaders (LAW_MAKING position " +
      "holders across all civilisations), artifactCreators (top-20 by " +
      "count, with sample artifact names — dead or alive), megabeasts / " +
      "semimegabeasts / forgottenBeasts / nightCreatures / demons / " +
      "titans (alive, by race flag), necromancers (alive, hf.info.secret " +
      "set, capped 30), cursedFigures (vampires/werebeasts, curse_year " +
      "set), heroes (alive, >=10 worldgen kills, capped 30 by kill " +
      "count). Each entry carries histfigId + names + race + birth/death " +
      "years + alive flag + category extras (positionCode, " +
      "artifactCount/Samples, killCount, whereabouts) — pivot to " +
      "dwarf_biography with the histfigId for the deep read. Per-category " +
      "totals are surfaced separately when entries were capped. Beasts/ " +
      "leaders/necromancers default to alive-only; pass " +
      "include_dead=true to include deceased. " +
      RUN_LUA_NOTE,
    {
      include_dead: z
        .boolean()
        .optional()
        .describe(
          "Include deceased figures in beasts/leaders/necromancers/heroes/" +
            "cursed categories. Artifact creators always include the dead " +
            "(the artifact's fame outlives the maker). Default: false.",
        ),
    },
    async ({ include_dead }) => {
      try {
        const data = await callLegends<unknown>(
          "living_legends",
          include_dead ? ["include_dead"] : [],
        );
        await enrichLivingLegends(data);
        return jsonResult(data);
      } catch (err) {
        return missingOrError(err);
      }
    },
  );

  server.tool(
    "list_fortress_nobles",
    "List the current noble-position assignments in the fortress group " +
      "and parent civilisation. One record per assignment, with " +
      "positionCode (e.g. CHIEF_MEDICAL_DWARF), positionName (display " +
      "form), and the holder resolved to a histfig ref with displayName + " +
      "histfigId — pivot straight into dwarf_biography with that id. " +
      "Vacant positions are surfaced with vacant=true. " +
      "Default scope is fort+civ; pass scope=all to walk every entity " +
      "(big payload). Replaces the prior describe_unit-per-candidate " +
      "scan for role-based lookups ('who is my mayor / broker / chief " +
      "medical dwarf'). " +
      RUN_LUA_NOTE,
    {
      scope: z
        .enum(["fort", "civ", "fort_and_civ", "all"])
        .optional()
        .describe(
          "Which entities to walk. 'fort' = the fortress group only; " +
            "'civ' = parent civilisation only; 'fort_and_civ' (default) = " +
            "both; 'all' = every entity in the world (large response).",
        ),
    },
    async ({ scope }) => {
      try {
        const data = await callLegends<unknown>("list_noble_positions", [
          scope ?? "fort_and_civ",
        ]);
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
