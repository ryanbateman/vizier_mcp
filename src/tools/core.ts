import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../dfhack/client.js";

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

  server.tool("list_job_skills", "List all job skills, professions, and unit labors with their attributes", {}, async () => {
    try {
      const client = await getClient();
      const result = await client.call("ListJobSkills");
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
    "list_materials",
    "List material definitions (stone, metal, wood, glass, etc.) with optional filters",
    {
      builtin: z.boolean().optional().describe("Include builtin materials (default: false)"),
      inorganic: z.boolean().optional().describe("Include inorganic materials like stone, metal, gem (default: false)"),
      creatures: z.boolean().optional().describe("Include creature materials like leather, bone, silk (default: false)"),
      plants: z.boolean().optional().describe("Include plant materials like wood, cloth (default: false)"),
    },
    async ({ builtin, inorganic, creatures, plants }) => {
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
    },
    async ({ scan_all, race, civ_id, dead, alive, sane, mask }) => {
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
