import { getClient } from "../dfhack/client.js";
import { ensureLookups, enrichInventory, resolveUnitNames } from "../enrichment.js";
import type { CreatureRaw, UnitBase } from "../dfhack/proto-types.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function callTool(method: string, input?: Record<string, unknown>): Promise<ToolResult> {
  try {
    const client = await getClient();
    const result = await client.call(method, input);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
  }
}

export async function callToolTyped<T>(method: string, input?: Record<string, unknown>): Promise<T> {
  const client = await getClient();
  return client.callTyped<T>(method, input);
}

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export async function enrichCreatureList(creatures: CreatureRaw[]): Promise<void> {
  try {
    const lookups = await ensureLookups();
    for (const u of creatures) enrichInventory(u, lookups);
  } catch (err: unknown) {
    console.error(`[vizier-mcp] Failed to enrich unit inventory: ${formatError(err)}`);
  }
}

export async function enrichUnitList(units: UnitBase[]): Promise<void> {
  try {
    const lookups = await ensureLookups();
    for (const u of units) resolveUnitNames(u, lookups);
  } catch (err: unknown) {
    console.error(`[vizier-mcp] Failed to enrich unit data: ${formatError(err)}`);
  }
}