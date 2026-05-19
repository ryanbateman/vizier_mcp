import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { paginate } from "../pagination.js";
import { jsonResult, errorResult, callToolTyped } from "./helpers.js";
import { getReferenceDataset, REFERENCE_KINDS, type ReferenceKind } from "../lookup-cache.js";
import type { ListMaterialsOut } from "../dfhack/proto-types.js";

// For list-shaped datasets, the array lives under one top-level key.
const ARRAY_KEY: Partial<Record<ReferenceKind, string>> = {
  materials: "materialList",
  item_types: "materialList",
  creature_raws: "creatureRaws",
  plant_raws: "plantRaws",
  building_defs: "buildingList",
  tiletypes: "tiletypeList",
};

const KIND_DESCRIPTIONS: Record<ReferenceKind, string> = {
  materials: "All material definitions (stone, metal, wood, glass, etc.)",
  item_types: "Item type definitions (weapons, armor, furniture, etc.)",
  enums: "Enum definitions (unit flags, material flags, etc.)",
  job_skills: "Job skills, professions, and unit labors with attributes",
  creature_raws: "All creature raw definitions (every creature type)",
  plant_raws: "All plant raw definitions (every plant type)",
  building_defs: "Building type definitions (workshops, furnaces, traps, etc.)",
  tiletypes: "Tile type definitions (wall, floor, ramp, stair types, etc.)",
  language: "Language and translation data used for item/unit names",
};

/** Re-shape a cached dataset into a consistent, optionally-paginated envelope. */
function shapeReference(
  kind: ReferenceKind,
  data: Record<string, unknown>,
  type?: string,
  offset?: number,
  limit?: number,
): unknown {
  if (kind === "job_skills") {
    if (type) {
      const arr = (data[type] as unknown[]) ?? [];
      return { kind, type, ...paginate(arr, offset ?? 0, limit ?? 100) };
    }
    return { kind, data };
  }
  if (kind === "enums" || kind === "language") {
    return { kind, data };
  }
  const arrKey = ARRAY_KEY[kind]!;
  const arr = (data[arrKey] as unknown[]) ?? [];
  return { kind, key: arrKey, ...paginate(arr, offset ?? 0, limit ?? 100) };
}

export function registerReferenceTools(server: McpServer) {
  server.tool(
    "get_reference_data",
    "Get static game reference data (materials, item types, enums, job skills, " +
      "creature/plant raws, building defs, tiletypes, language). Cached per save " +
      "— cheap to call repeatedly. Note: unit/item tool responses already have " +
      "names resolved, so you usually do NOT need this just to decode IDs.",
    {
      kind: z.enum(REFERENCE_KINDS as [ReferenceKind, ...ReferenceKind[]])
        .describe(
          Object.entries(KIND_DESCRIPTIONS).map(([k, d]) => `${k}: ${d}`).join("; "),
        ),
      type: z.enum(["skill", "profession", "labor"]).optional()
        .describe("Only for kind=job_skills: return just this sub-type (paginated)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ kind, type, offset, limit }) => {
      try {
        const data = await getReferenceDataset<Record<string, unknown>>(kind);
        return jsonResult(shapeReference(kind, data, type, offset, limit));
      } catch (err: unknown) {
        return errorResult(err);
      }
    }
  );

  // --- Backwards-compatible aliases for the documented tools ---

  server.tool(
    "list_enums",
    "[alias for get_reference_data kind=enums] List all enum definitions (material flags, unit flags, labors, skills, professions, etc.)",
    {},
    async () => {
      try {
        const data = await getReferenceDataset<Record<string, unknown>>("enums");
        return jsonResult(data);
      } catch (err: unknown) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "list_job_skills",
    "[alias for get_reference_data kind=job_skills] List job skills, professions, and unit labors with their attributes",
    {
      type: z.enum(["skill", "profession", "labor"]).optional().describe("Return only this type (paginates). If omitted, returns all three types."),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ type, offset, limit }) => {
      try {
        const data = await getReferenceDataset<Record<string, unknown>>("job_skills");
        return jsonResult(shapeReference("job_skills", data, type, offset, limit));
      } catch (err: unknown) {
        return errorResult(err);
      }
    }
  );

  // list_materials keeps distinct semantics: a live *filtered* query
  // (ListMaterials), not the full static dump exposed via get_reference_data.
  server.tool(
    "list_materials",
    "List material definitions (stone, metal, wood, glass, etc.) with optional filters. For the full unfiltered dump use get_reference_data kind=materials.",
    {
      builtin: z.boolean().optional().describe("Include builtin materials (default: false)"),
      inorganic: z.boolean().optional().describe("Include inorganic materials like stone, metal, gem (default: false)"),
      creatures: z.boolean().optional().describe("Include creature materials like leather, bone, silk (default: false)"),
      plants: z.boolean().optional().describe("Include plant materials like wood, cloth (default: false)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ builtin, inorganic, creatures, plants, offset, limit }) => {
      try {
        const input: Record<string, unknown> = {};
        if (builtin !== undefined) input["builtin"] = builtin;
        if (inorganic !== undefined) input["inorganic"] = inorganic;
        if (creatures !== undefined) input["creatures"] = creatures;
        if (plants !== undefined) input["plants"] = plants;
        if (Object.keys(input).length === 0) input["inorganic"] = true;
        const result = await callToolTyped<ListMaterialsOut>("ListMaterials", input);
        return jsonResult(paginate(result.value ?? [], offset ?? 0, limit ?? 100));
      } catch (err: unknown) {
        return errorResult(err);
      }
    }
  );
}

/**
 * Expose every static reference dataset as an MCP resource so clients fetch
 * once and cache, eliminating repeat tool calls. Backed by the same per-save
 * cache as get_reference_data.
 */
export function registerReferenceResources(server: McpServer) {
  for (const kind of REFERENCE_KINDS) {
    const uri = `vizier://reference/${kind.replace(/_/g, "-")}`;
    server.resource(
      `reference-${kind}`,
      uri,
      { description: KIND_DESCRIPTIONS[kind], mimeType: "application/json" },
      async (u: URL) => {
        const data = await getReferenceDataset(kind);
        return {
          contents: [
            { uri: u.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
          ],
        };
      },
    );
  }
}
