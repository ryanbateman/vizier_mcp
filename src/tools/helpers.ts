import { callRpc } from "../dfhack/client.js";
import {
  ensureLookups,
  enrichInventory,
  resolveUnitNames,
  resolveCreatureRace,
} from "../enrichment.js";
import { paginate } from "../pagination.js";
import type {
  CreatureRaw,
  ListUnitsOut,
  ResolvedName,
  UnitBase,
} from "../dfhack/proto-types.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

/**
 * Boilerplate appended to every unit-returning tool description so agents
 * render dwarf names the way the DF UI shows them. Kept in one place to keep
 * the wording uniform across tools.
 */
export const STRUCTURED_NAME_NOTE =
  " Each unit's `name` is a structured object { firstName, lastName, " +
  "englishName, nickname }. The DF UI displays dwarves as `firstName + " +
  "\" \" + lastName` (e.g. \"Bëmbul Fikodad\") — when referencing a dwarf " +
  "to the user, use that form so they can find them in the game. " +
  "`englishName` is the English translation of the dwarvish surname " +
  "(\"Glazesuns\" for the Fikodad example) and is flavour, not an " +
  "identifier. Nickname, when present, is a player-assigned override.";

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

/**
 * RFR's GetUnitList returns each name as a pre-composed "firstName englishName"
 * string, which is NOT what the DF UI displays (the UI shows the dwarvish
 * surname, i.e. firstName + lastName). Fetch the structured name from Core's
 * ListUnits and overlay it onto each CreatureRaw by id so callers see
 * { firstName, lastName, englishName, nickname }.
 *
 * Best-effort: if the second RPC fails, the original RFR strings remain and
 * the request still succeeds (just less useful).
 */
export async function overlayStructuredNames(
  creatures: CreatureRaw[],
): Promise<void> {
  if (creatures.length === 0) return;
  try {
    const coreResult = await callRpc<ListUnitsOut>("ListUnits", {
      scanAll: true,
    });
    const core = coreResult.value ?? [];
    const byId = new Map<number, ResolvedName>();
    for (const u of core) {
      const uid = (u as { unitId?: number }).unitId;
      if (typeof uid !== "number") continue;
      if (u.name && typeof u.name === "object") byId.set(uid, u.name);
    }
    for (const c of creatures) {
      if (typeof c.id !== "number") continue;
      const structured = byId.get(c.id);
      if (structured) c.name = { ...structured };
    }
  } catch (err: unknown) {
    console.error(
      `[vizier-mcp] Failed to overlay structured names: ${formatError(err)}`,
    );
  }
}
