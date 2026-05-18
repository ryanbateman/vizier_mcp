import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../dfhack/client.js";

type LookupTables = {
  profession: Map<number, { key: string; caption: string }>;
  skill: Map<number, { key: string; caption: string; captionNoun: string }>;
  labor: Map<number, { key: string; caption: string }>;
  unitFlags1: Map<number, string>;
  unitFlags2: Map<number, string>;
  unitFlags3: Map<number, string>;
  deathInfoFlags: Map<number, string>;
};

let cachedLookups: LookupTables | null = null;

async function ensureLookups(): Promise<LookupTables> {
  if (cachedLookups) return cachedLookups;
  const client = await getClient();
  const result = await client.call("ListJobSkills");

  const profession = new Map<number, { key: string; caption: string }>();
  for (const p of (result as any).profession ?? []) {
    profession.set(p.id, { key: p.key, caption: p.caption });
  }

  const skill = new Map<number, { key: string; caption: string; captionNoun: string }>();
  for (const s of (result as any).skill ?? []) {
    skill.set(s.id, { key: s.key, caption: s.caption, captionNoun: s.captionNoun });
  }

  const labor = new Map<number, { key: string; caption: string }>();
  for (const l of (result as any).labor ?? []) {
    labor.set(l.id, { key: l.key, caption: l.caption });
  }

  const enums = await client.call("ListEnums");
  const unitFlags1 = new Map<number, string>();
  for (const f of (enums as any).unitFlags1 ?? []) unitFlags1.set(f.value, f.name);
  const unitFlags2 = new Map<number, string>();
  for (const f of (enums as any).unitFlags2 ?? []) unitFlags2.set(f.value, f.name);
  const unitFlags3 = new Map<number, string>();
  for (const f of (enums as any).unitFlags3 ?? []) unitFlags3.set(f.value, f.name);
  const deathInfoFlags = new Map<number, string>();
  for (const f of (enums as any).deathInfoFlags ?? []) deathInfoFlags.set(f.value, f.name);

  cachedLookups = { profession, skill, labor, unitFlags1, unitFlags2, unitFlags3, deathInfoFlags };
  return cachedLookups;
}

function decodeFlags(value: number, map: Map<number, string>): string[] {
  const names: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (value & (1 << bit)) {
      const name = map.get(bit);
      if (name) names.push(name);
    }
  }
  return names;
}

function resolveUnitNames(unit: any, lookups: LookupTables) {
  if (unit.profession !== undefined) {
    const p = lookups.profession.get(unit.profession);
    if (p) unit.professionName = p.caption;
  }
  if (unit.gender === 0) unit.genderName = "Female";
  else if (unit.gender === 1) unit.genderName = "Male";
  if (unit.flags1 !== undefined) unit.flags1Names = decodeFlags(unit.flags1, lookups.unitFlags1);
  if (unit.flags2 !== undefined) unit.flags2Names = decodeFlags(unit.flags2, lookups.unitFlags2);
  if (unit.flags3 !== undefined) unit.flags3Names = decodeFlags(unit.flags3, lookups.unitFlags3);
  if (unit.deathFlags !== undefined) unit.deathFlagsNames = decodeFlags(unit.deathFlags, lookups.deathInfoFlags);
  if (unit.skills) {
    for (const s of unit.skills) {
      const def = lookups.skill.get(s.id);
      if (def) {
        s.name = def.caption;
        s.nameNoun = def.captionNoun;
      }
    }
  }
  if (unit.labors) {
    unit.labors = unit.labors.map((id: number) => {
      const def = lookups.labor.get(id);
      return { id, name: def?.caption ?? `Labor ${id}` };
    });
  }
}

function paginate<T>(items: T[], offset: number, limit: number): { total: number; offset: number; limit: number; items: T[] } {
  const start = Math.min(offset, items.length);
  const end = Math.min(start + limit, items.length);
  return {
    total: items.length,
    offset: start,
    limit,
    items: items.slice(start, end),
  };
}

export function registerCoreTools(server: McpServer) {
  server.tool("list_enums", "List all enum definitions used in game data (material flags, unit flags, labors, skills, professions, etc.)", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("ListEnums");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool(
    "list_job_skills",
    "List all job skills, professions, and unit labors with their attributes",
    {
      type: z.enum(["skill", "profession", "labor"]).optional().describe("Return only this type (paginates). If omitted, returns all three types unpaginated."),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ type, offset, limit }) => {
      try {
        const client = await getClient();
        const result = await client.call("ListJobSkills");
        if (type) {
          const values = (result as any)[type] ?? [];
          const page = paginate(values, offset ?? 0, limit ?? 100);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_materials",
    "List material definitions (stone, metal, wood, glass, etc.) with optional filters",
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
        const client = await getClient();
        const input: Record<string, unknown> = {};
        if (builtin !== undefined) input["builtin"] = builtin;
        if (inorganic !== undefined) input["inorganic"] = inorganic;
        if (creatures !== undefined) input["creatures"] = creatures;
        if (plants !== undefined) input["plants"] = plants;
        if (Object.keys(input).length === 0) {
          input["inorganic"] = true;
        }
        const result = await client.call("ListMaterials", input);
        const values = (result as any).value ?? [];
        const page = paginate(values, offset ?? 0, limit ?? 100);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_units",
    "List units in the fortress with optional filters. Returns names, positions, races, skills. Note: response can be large for big fortresses.",
    {
      scan_all: z.boolean().optional().describe("Scan all active and killed units (default: false)"),
      race: z.number().optional().describe("Filter by race ID (e.g., 572 for dwarves)"),
      civ_id: z.number().optional().describe("Filter by civilization ID"),
      dead: z.boolean().optional().describe("Filter to dead units only"),
      alive: z.boolean().optional().describe("Filter to alive units only"),
      sane: z.boolean().optional().describe("Filter to sane units only (not dead, ghost, zombie, or insane)"),
      mask: z.object({
        profession: z.boolean().optional().describe("Include profession, custom profession, and squad assignment data"),
        skills: z.boolean().optional().describe("Include skill levels and experience for each unit"),
        labors: z.boolean().optional().describe("Include enabled labors for each unit"),
        miscTraits: z.boolean().optional().describe("Include misc traits data for each unit"),
      }).optional().describe("Data mask controlling which additional unit fields are returned"),
      name: z.string().optional().describe("Filter units by name (substring match, case-insensitive, matches first/last/english/nickname)"),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default: 0)"),
      limit: z.number().int().min(1).max(200).optional().describe("Page size (default: 100)"),
    },
    async ({ scan_all, race, civ_id, dead, alive, sane, mask, name, offset, limit }) => {
      try {
        const client = await getClient();
        const input: Record<string, unknown> = {};
        if (race !== undefined) input["race"] = race;
        if (civ_id !== undefined) input["civId"] = civ_id;
        if (dead !== undefined) input["dead"] = dead;
        if (alive !== undefined) input["alive"] = alive;
        if (sane !== undefined) input["sane"] = sane;
        if (mask !== undefined) input["mask"] = mask;
        if (scan_all !== undefined) {
          input["scanAll"] = scan_all;
        } else if (Object.keys(input).length > 0) {
          input["scanAll"] = true;
        }
        const result = await client.call("ListUnits", input);
        let values = (result as any).value ?? [];
        if (name) {
          const lower = name.toLowerCase();
          values = values.filter((u: any) => {
            const n = u.name;
            return (n?.firstName?.toLowerCase().includes(lower) ||
                    n?.lastName?.toLowerCase().includes(lower) ||
                    n?.englishName?.toLowerCase().includes(lower) ||
                    n?.nickname?.toLowerCase().includes(lower));
          });
        }
        const lookups = await ensureLookups();
        for (const unit of values) {
          resolveUnitNames(unit, lookups);
        }
        const page = paginate(values, offset ?? 0, limit ?? 100);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool("list_squads", "List all military squads and their members", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("ListSquads");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  server.tool(
    "set_unit_labors",
    "Set labor assignments for units by unit ID and labor ID",
    {
      changes: z.array(z.object({
        unit_id: z.number().describe("Unit ID to modify"),
        labor: z.number().describe("Labor ID (from list_enums)"),
        value: z.boolean().describe("Enable or disable the labor"),
      })).describe("List of labor changes to apply"),
    },
    async ({ changes }) => {
      try {
        const client = await getClient();
        const result = await client.call("SetUnitLabors", {
          change: changes.map((c) => ({
            unitId: c.unit_id,
            labor: c.labor,
            value: c.value,
          })),
        });
        return {
          content: [{ type: "text" as const, text: "Labors updated successfully" }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
