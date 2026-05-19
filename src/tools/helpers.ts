import { callRpc } from "../dfhack/client.js";
import {
  ensureLookups,
  enrichInventory,
  resolveUnitNames,
  resolveCreatureRace,
} from "../enrichment.js";
import { paginate } from "../pagination.js";
import type { CreatureRaw, UnitBase } from "../dfhack/proto-types.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

/** Canonical error formatter. Single source of truth for the whole server. */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Wrap arbitrary data in the standard MCP text/JSON success envelope. */
export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Standard error envelope used by every tool. */
export function errorResult(err: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: `Error: ${formatError(err)}` }], isError: true };
}

/** Consistent paginated envelope: { total, offset, limit, items }. */
export function paginatedResult<T>(items: T[], offset?: number, limit?: number): ToolResult {
  return jsonResult(paginate(items, offset ?? 0, limit ?? 100));
}

export async function callTool(method: string, input?: Record<string, unknown>): Promise<ToolResult> {
  try {
    const result = await callRpc(method, input);
    return jsonResult(result);
  } catch (err: unknown) {
    return errorResult(err);
  }
}

export async function callToolTyped<T>(method: string, input?: Record<string, unknown>): Promise<T> {
  return callRpc<T>(method, input);
}

export async function enrichCreatureList(creatures: CreatureRaw[]): Promise<void> {
  try {
    const lookups = await ensureLookups();
    for (const u of creatures) {
      enrichInventory(u, lookups);
      resolveCreatureRace(u, lookups);
    }
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
